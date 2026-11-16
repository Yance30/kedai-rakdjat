import 'fake-indexeddb/auto';
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db';
import { cleanCustomerName, closeShift, commitSale, priceOrder } from '../src/transactions';
import { createBackup, parseBackup } from '../src/backup';
import { snapshot } from '../src/sync-payload';
import { buildTicket, queueLabel } from '../src/printer';
import type { CartDraft, Order, Payment } from '../src/types';

vi.mock('../src/supabase', () => ({ deviceId: async () => 'test-device', cloudProject: () => 'https://example.supabase.co', loadSupabase: vi.fn() }));
vi.mock('../src/sync', () => ({ exclusive: async (run: () => Promise<unknown>) => run() }));

beforeEach(async () => {
  await db.delete(); await db.open();
  await db.shifts.add({ id: 1, staffId: 2, status: 'open', openedAt: 1000, openingFloat: 0 });
});
afterAll(() => db.close());

const cash = (requestId: string, amount: number): Payment => ({ requestId, orderId: 0, shiftId: 1, method: 'cash', amount, tendered: amount, change: 0, createdAt: 2000 });
const sale = (subtotal: number, extra: Partial<Order> = {}): Order => ({ shiftId: 1, status: 'paid', createdAt: 1500, subtotal, ...priceOrder(subtotal, 0, 0), orderType: 'dine_in', ...extra });
const kopi = (qty: number) => [{ productId: 1, name: 'Kopi', qty, price: 10000 }];

describe('nomor antrean', () => {
  it('fresh install tidak lagi membuat meja', async () => {
    expect(await db.meja.count()).toBe(0);
  });

  it('naik per pesanan dan mulai lagi dari 1 di shift berikutnya', async () => {
    const a = await commitSale(sale(10000), kopi(1), cash('a', 11000), 2, null);
    const b = await commitSale(sale(10000, { customerName: '  Budi   Santoso ' }), kopi(1), cash('b', 11000), 2, null);
    expect(await db.orders.get(a)).toMatchObject({ queueNo: 1 });
    expect(await db.orders.get(b)).toMatchObject({ queueNo: 2, customerName: 'Budi Santoso' });
    await closeShift(1, 1, 22000);
    await db.shifts.add({ id: 2, staffId: 2, status: 'open', openedAt: 3000, openingFloat: 0 });
    const c = await commitSale(sale(10000, { shiftId: 2 }), kopi(1), { ...cash('c', 11000), shiftId: 2 }, 2, null);
    expect((await db.orders.get(c))?.queueNo).toBe(1);
  });

  it('nama pelanggan dibatasi dan nama kosong tidak disimpan', async () => {
    expect(cleanCustomerName('   ')).toBeUndefined();
    expect(() => cleanCustomerName('x'.repeat(31))).toThrow('maksimal 30');
    const id = await commitSale(sale(10000, { customerName: ' ' }), kopi(1), cash('a', 11000), 2, null);
    expect((await db.orders.get(id))?.customerName).toBeUndefined();
  });

  it('tercetak di tiket dapur, tersinkron dan lolos validasi backup', async () => {
    const id = await commitSale(sale(10000, { customerName: 'Sari' }), kopi(1), cash('a', 11000), 2, null);
    const order = (await db.orders.get(id))!;
    expect(queueLabel(order)).toBe('Antrean 1 · Sari');
    const ticket = new TextDecoder().decode(buildTicket(order, [{ orderId: id, productId: 1, name: 'Kopi', qty: 1, price: 10000 }]));
    expect(ticket).toContain('ANTREAN 1');
    expect(ticket).toContain('Sari');
    const rows = await snapshot('dev');
    expect(rows.orders[0]).toMatchObject({ queue_no: 1, customer_name: 'Sari' });
    const backup = await createBackup();
    expect(() => parseBackup(JSON.stringify(backup))).not.toThrow();
    backup.data.orders[0].queueNo = 0;
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('antrean');
  });
});

describe('pisah bayar tanpa meja', () => {
  const draft = (lines: number, revision = 1): CartDraft => ({
    key: 'shift:1:staff:2:counter', shiftId: 1, staffId: 2, tableId: null, orderId: null, requestId: 'r1', orderType: 'dine_in',
    lines: [{ product: { id: 1, name: 'Kopi', price: 10000, category: 'Coffee', active: 1 }, qty: lines }], customerName: 'Rombongan', updatedAt: 1, revision,
  });

  it('bagian pertama lunas, sisa tersimpan sebagai keranjang dengan antrean yang sama', async () => {
    await db.drafts.put(draft(3));
    const rest: CartDraft = { ...draft(2, 2), requestId: 'r2' };
    const first = await commitSale(sale(10000, { customerName: 'Rombongan' }), kopi(1), cash('r1', 11000), 2, null, { key: rest.key, revision: 1 }, undefined, rest);
    expect(await db.orders.get(first)).toMatchObject({ queueNo: 1, status: 'paid', subtotal: 10000 });
    const saved = (await db.drafts.get(rest.key))!;
    expect(saved).toMatchObject({ queueNo: 1, requestId: 'r2', revision: 2 });
    expect(saved.lines[0].qty).toBe(2);
    // Shift cannot close while the rest is unpaid.
    await expect(closeShift(1, 1, 11000)).rejects.toThrow('keranjang');
    // A retry of the first part returns the same order and keeps the rest.
    expect(await commitSale(sale(10000), kopi(1), cash('r1', 11000), 2, null, { key: rest.key, revision: 1 }, undefined, rest)).toBe(first);
    const second = await commitSale(sale(20000, { queueNo: saved.queueNo, customerName: 'Rombongan' }), kopi(2), cash('r2', 22000), 2, null, { key: rest.key, revision: 2 });
    expect(await db.orders.get(second)).toMatchObject({ queueNo: 1, subtotal: 20000 });
    expect(await db.drafts.get(rest.key)).toBeUndefined();
    await closeShift(1, 1, 33000);
  });

  it('menolak sisa yang kosong atau dari keranjang lain', async () => {
    await db.drafts.put(draft(3));
    await expect(commitSale(sale(10000), kopi(1), cash('x', 11000), 2, null, { key: 'shift:1:staff:2:counter', revision: 1 }, undefined, { ...draft(0), lines: [] })).rejects.toThrow('sebagian');
    await expect(commitSale(sale(10000), kopi(1), cash('x', 11000), 2, null, { key: 'lain', revision: 1 }, undefined, draft(2))).rejects.toThrow('sebagian');
  });
});
