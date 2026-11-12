import 'fake-indexeddb/auto';
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '../src/db';
import { closeShift, commitSale, commitSplit, priceOrder, reverseOrder } from '../src/transactions';
import { createBackup, dailySnapshot, listSnapshots, parseBackup, restoreBackup, takeAutoSnapshot } from '../src/backup';
import { applyCloudRestore, previewCloudRestore } from '../src/cloud-restore';
import { snapshot } from '../src/sync-payload';
import { authenticatePin } from '../src/auth';
import type { Order, Payment } from '../src/types';

vi.mock('../src/supabase', () => ({ deviceId: async () => 'test-device', cloudProject: () => 'https://example.supabase.co', loadSupabase: vi.fn() }));
vi.mock('../src/sync', () => ({ exclusive: async (run: () => Promise<unknown>) => run() }));

beforeEach(async () => {
  await db.delete(); await db.open();
  await db.shifts.add({ id: 1, staffId: 2, status: 'open', openedAt: 1000, openingFloat: 0 });
});
afterAll(() => db.close());

/** Table 1: 2× Nasi Lemak (35.000) + 1× Es Teh (12.000), saved to the kitchen. */
async function openTableOrder() {
  const subtotal = 2 * 35000 + 12000;
  const id = await db.orders.add({ shiftId: 1, status: 'open', createdAt: 1000, subtotal, ...priceOrder(subtotal, 0, 0), orderType: 'dine_in', tableId: 1 });
  await db.orderItems.bulkAdd([{ orderId: id, productId: 1, name: 'Nasi Lemak Spesial', qty: 2, price: 35000 }, { orderId: id, productId: 7, name: 'Es Teh Manis', qty: 1, price: 12000 }]);
  await db.meja.update(1, { status: 'occupied' });
  return id;
}
const cash = (requestId: string, amount: number, tendered = amount): Payment => ({ requestId, orderId: 0, shiftId: 1, method: 'cash', amount, tendered, change: tendered - amount, createdAt: 2000 });

describe('pisah bill', () => {
  it('memindahkan item terpilih ke pesanan lunas sendiri; sisa tetap terbuka di meja', async () => {
    const parent = await openTableOrder();
    const id = await commitSplit(parent, [{ productId: 1, qty: 1 }], cash('split-1', 38500, 50000), 2, 0);
    expect(await db.orders.get(id)).toMatchObject({ status: 'paid', subtotal: 35000, tax: 3500, total: 38500, splitFrom: parent, tableId: 1, cashierId: 2 });
    expect(await db.orders.get(parent)).toMatchObject({ status: 'open', subtotal: 47000, total: 51700 });
    expect((await db.orderItems.where('orderId').equals(parent).toArray()).map(i => [i.productId, i.qty])).toEqual([[1, 1], [7, 1]]);
    expect(await db.payments.where('orderId').equals(id).first()).toMatchObject({ amount: 38500, change: 11500 });
    expect((await db.meja.get(1))?.status).toBe('occupied');
    // Retrying the same request (e.g. after a printer error) does not pay twice.
    expect(await commitSplit(parent, [{ productId: 1, qty: 1 }], cash('split-1', 38500, 50000), 2, 0)).toBe(id);
    expect(await db.payments.count()).toBe(1);
    expect((await snapshot('dev')).orders.find(o => o.local_id === id)).toMatchObject({ split_from_local_id: parent });
  });
  it('menolak memilih semua item, jumlah berlebih, dan total yang tidak cocok', async () => {
    const parent = await openTableOrder();
    await expect(commitSplit(parent, [{ productId: 1, qty: 2 }, { productId: 7, qty: 1 }], cash('a', 90200), 2, 0)).rejects.toThrow('Semua item');
    await expect(commitSplit(parent, [{ productId: 7, qty: 2 }], cash('b', 26400), 2, 0)).rejects.toThrow('melebihi');
    await expect(commitSplit(parent, [{ productId: 7, qty: 1 }], cash('c', 1000), 2, 0)).rejects.toThrow('berubah');
    expect(await db.payments.count()).toBe(0);
    expect(await db.orderItems.where('orderId').equals(parent).count()).toBe(2);
  });
  it('service charge dan diskon dihitung per bagian; refund bagian tidak mengosongkan meja', async () => {
    const parent = await openTableOrder();
    const { changePin } = await import('../src/auth');
    await changePin(1, '987654');
    const part = priceOrder(12000, 2000, 5); // diskon 2.000, service 5%
    const id = await commitSplit(parent, [{ productId: 7, qty: 1 }], cash('d', part.total), 2, 5, { amount: 2000, reason: 'Pelanggan tetap', pin: '987654' });
    expect(await db.orders.get(id)).toMatchObject({ discount: 2000, discountApproverId: 1, service: 500, total: part.total });
    expect(await db.audit.where('action').equals('discount').count()).toBe(1);
    await reverseOrder(id, 2, 1, 'Salah input');
    expect((await db.meja.get(1))?.status).toBe('occupied');
    // Paying what is left closes the table; the shift then reconciles both payments.
    const rest = (await db.orders.get(parent))!;
    const items = (await db.orderItems.where('orderId').equals(parent).toArray()).map(({ id: _i, orderId: _o, ...i }) => i);
    await commitSale(rest as Order, items, cash('rest', rest.total), 2, parent);
    expect((await db.meja.get(1))?.status).toBe('cleaning');
    await closeShift(1, 2, rest.total);
  });
  it('backup memvalidasi rujukan pisah bill', async () => {
    const parent = await openTableOrder();
    await commitSplit(parent, [{ productId: 1, qty: 1 }], cash('e', 38500), 2, 0);
    const backup = await createBackup();
    expect(() => parseBackup(JSON.stringify(backup))).not.toThrow();
    backup.data.orders.find(o => o.splitFrom)!.splitFrom = 999;
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('pisah bill');
  });
});

/** Serves snapshot rows like PostgREST, with a low max-rows limit to exercise paging. */
function fakeCloud(rows: Record<string, Record<string, unknown>[]>, role = 'owner', maxRows = 2) {
  return {
    from(table: string) {
      if (table === 'cloud_memberships') return { select: () => ({ eq: async () => ({ data: [{ role }], error: null }) }) };
      const all = (rows[table] ?? []).map(r => table === 'orders' ? { ...r, kds_status: 'ready' } : { ...r });
      const q = { select: () => q, eq: () => q, order: () => q, range: async (a: number, b: number) => ({ data: all.slice(a, Math.min(b + 1, a + maxRows)), error: null, count: all.length }) };
      return q;
    },
  } as unknown as SupabaseClient;
}

describe('pulihkan dari cloud', () => {
  async function businessDay() {
    const parent = await openTableOrder();
    await commitSplit(parent, [{ productId: 1, qty: 1 }], cash('f', 38500), 2, 0);
    const { addExpense } = await import('../src/operations');
    await addExpense({ date: '2026-11-11', category: 'Lainnya', description: 'Beli es batu', amount: 5000 }, 1, true);
    return snapshot('tab-old');
  }
  it('membangun ulang data tablet persis seperti yang disinkron, dengan PIN baru dan identitas perangkat cloud', async () => {
    const cloud = await businessDay();
    const preview = await previewCloudRestore(fakeCloud(cloud), 'tab-old');
    expect(preview.staff.map(s => s.name)).toEqual(['Budi Santoso', 'Sari']);
    expect(preview.orders).toBe(2);
    await db.products.update(1, { name: 'Data lokal yang akan diganti' });
    await expect(applyCloudRestore(preview, { 1: '246810', 2: '246810' })).rejects.toThrow('berbeda');
    await expect(applyCloudRestore(preview, { 1: '1234', 2: '135790' })).rejects.toThrow('demo');
    await applyCloudRestore(preview, { 1: '246810', 2: '135790' });
    expect(await snapshot('tab-old')).toEqual(cloud);
    expect((await db.settings.get('device_id'))?.value).toBe('tab-old');
    expect((await db.settings.get('sync_paused'))?.value).toBe('true');
    const owner = await authenticatePin('246810', false, 1);
    expect(owner.mustChangePin).toBe(true);
    expect((await listSnapshots()).find(s => s.kind === 'restore')).toBeTruthy();
  });
  it('hanya owner yang boleh memulihkan, dan data cloud yang tidak konsisten ditolak', async () => {
    const cloud = await businessDay();
    await expect(previewCloudRestore(fakeCloud(cloud, 'cashier'), 'tab-old')).rejects.toThrow('owner');
    const broken = { ...cloud, payments: cloud.payments.map(p => ({ ...p, amount: 1 })) };
    await expect(previewCloudRestore(fakeCloud(broken), 'tab-old')).rejects.toThrow('Backup ditolak');
    await expect(previewCloudRestore(fakeCloud({ ...cloud, staff: [] }), 'tab-old')).rejects.toThrow('belum memiliki data');
  });
});

describe('salinan otomatis', () => {
  it('sekali per hari (WIB), menyimpan 7 salinan otomatis terakhir tanpa menghapus salinan restore', async () => {
    const day = Date.parse('2026-11-12T01:00:00+07:00');
    expect(await dailySnapshot(day)).toBe(true);
    expect(await dailySnapshot(day + 20 * 3600_000)).toBe(false);
    expect(await dailySnapshot(day + 24 * 3600_000)).toBe(true);
    await restoreBackup(await createBackup());
    for (let i = 0; i < 8; i++) await takeAutoSnapshot('Tutup shift', day + i);
    const list = await listSnapshots();
    expect(list.filter(s => s.kind === 'auto')).toHaveLength(7);
    expect(list.filter(s => s.kind === 'restore')).toHaveLength(1);
    expect(parseBackup(JSON.stringify(JSON.parse((await db.recovery.get(list[0].id))!.data))).format).toBe('kedai-rakdjat');
  });
});

it('pesanan meja tersimpan dapat dibayar tanpa mengubah keranjang (tanpa draf tersimpan)', async () => {
  const parent = await openTableOrder();
  const rest = (await db.orders.get(parent))!;
  const items = (await db.orderItems.where('orderId').equals(parent).toArray()).map(({ id: _i, orderId: _o, ...i }) => i);
  await commitSale(rest as Order, items, cash('untouched', rest.total), 2, parent, { key: 'shift:1:table:1', revision: 0 });
  expect((await db.orders.get(parent))?.status).toBe('paid');
});
