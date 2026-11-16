import 'fake-indexeddb/auto';
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '../src/db';
import { commitSale, priceOrder } from '../src/transactions';
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

/** A table order saved by an earlier version: 2× Nasi Lemak (35.000) + 1× Es Teh (12.000). */
async function openTableOrder() {
  await db.meja.put({ id: 1, name: 'T-01', status: 'occupied' });
  const subtotal = 2 * 35000 + 12000;
  const id = await db.orders.add({ shiftId: 1, status: 'open', createdAt: 1000, subtotal, ...priceOrder(subtotal, 0, 0), orderType: 'dine_in', tableId: 1 });
  await db.orderItems.bulkAdd([{ orderId: id, productId: 1, name: 'Nasi Lemak Spesial', qty: 2, price: 35000 }, { orderId: id, productId: 7, name: 'Es Teh Manis', qty: 1, price: 12000 }]);
  return id;
}
const cash = (requestId: string, amount: number, tendered = amount): Payment => ({ requestId, orderId: 0, shiftId: 1, method: 'cash', amount, tendered, change: tendered - amount, createdAt: 2000 });

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
    const sale = (requestId: string, customerName?: string): Order => ({ shiftId: 1, status: 'paid', createdAt: 1500, subtotal: 35000, ...priceOrder(35000, 0, 0), orderType: 'dine_in', customerName });
    const item = [{ productId: 1, name: 'Nasi Lemak Spesial', qty: 1, price: 35000 }];
    await commitSale(sale('f', 'Budi'), item, cash('f', 38500), 2, null);
    await commitSale(sale('g'), item, cash('g', 38500), 2, null);
    const { addExpense } = await import('../src/operations');
    await addExpense({ date: '2026-11-11', category: 'Lainnya', description: 'Beli es batu', amount: 5000 }, 1, true);
    return snapshot('tab-old');
  }
  it('membangun ulang data tablet persis seperti yang disinkron, dengan PIN baru dan identitas perangkat cloud', async () => {
    const cloud = await businessDay();
    const preview = await previewCloudRestore(fakeCloud(cloud), 'tab-old');
    expect(preview.staff.map(s => s.name)).toEqual(['Owner', 'Kasir']);
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

it('pesanan meja dari versi lama tetap dapat dibayar (tanpa draf tersimpan)', async () => {
  const parent = await openTableOrder();
  const rest = (await db.orders.get(parent))!;
  const items = (await db.orderItems.where('orderId').equals(parent).toArray()).map(({ id: _i, orderId: _o, ...i }) => i);
  await commitSale(rest as Order, items, cash('untouched', rest.total), 2, parent, { key: 'shift:1:table:1', revision: 0 });
  expect((await db.orders.get(parent))?.status).toBe('paid');
});
