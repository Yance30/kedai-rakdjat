import 'fake-indexeddb/auto';
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db';
import { commitSale, reverseOrder, closeShift } from '../src/transactions';
import { createBackup, parseBackup, restoreBackup } from '../src/backup';
import { difference, snapshot } from '../src/sync-payload';
import { authenticatePin, changePin, secureHash, verifyPin } from '../src/auth';
import type { Order, Payment } from '../src/types';

vi.mock('../src/supabase', () => ({ deviceId: async () => 'test-device', cloudProject: () => 'https://example.supabase.co', loadSupabase: vi.fn() }));
vi.mock('../src/sync', () => ({ exclusive: async (run: () => Promise<unknown>) => run() }));
const order: Order = { shiftId: 1, status: 'paid', createdAt: 1000, subtotal: 10000, service: 0, tax: 1000, total: 11000, orderType: 'takeaway' };
const items = [{ productId: 1, name: 'Kopi', price: 10000, qty: 1 }];
const payment: Payment = { requestId: 'checkout-1', orderId: 0, shiftId: 1, method: 'cash', amount: 11000, tendered: 20000, change: 9000, createdAt: 1000 };
async function sale() { return commitSale(order, items, payment, 2, null); }
beforeEach(async () => {
  await db.delete(); await db.open();
  await db.shifts.add({ id: 1, staffId: 2, status: 'open', openedAt: 1000, openingFloat: 0 });
});
afterAll(() => db.close());

describe('transaksi offline dan rekonsiliasi', () => {
  it('dua pembayaran serentak dengan request yang sama hanya menghasilkan satu transaksi', async () => {
    const ids = await Promise.all([sale(), sale()]);
    expect(ids[0]).toBe(ids[1]);
    expect(await db.payments.count()).toBe(1);
    expect(await db.audit.count()).toBe(1);
  });
  it('dua request berbeda untuk pesanan meja yang sama tidak dapat membayar dua kali', async () => {
    const id = await db.orders.add({ ...order, status: 'open', tableId: 1 });
    await db.orderItems.add({ ...items[0], orderId: id });
    await commitSale(order, items, payment, 2, id);
    await expect(commitSale(order, items, { ...payment, requestId: 'second' }, 2, id)).rejects.toThrow('sudah dibayar');
    expect(await db.payments.count()).toBe(1);
  });
  it('menolak jumlah tidak valid tanpa menulis pesanan', async () => {
    await expect(commitSale(order, items, { ...payment, tendered: 1 }, 2, null)).rejects.toThrow();
    expect(await db.orders.count()).toBe(0);
  });
  it('request ID yang dipakai ulang dengan pembayaran berbeda ditolak', async () => {
    await sale();
    await expect(commitSale(order, items, { ...payment, method: 'qris', tendered: 11000, change: 0 }, 2, null)).rejects.toThrow('data berbeda');
    expect(await db.payments.count()).toBe(1);
  });
  it('refund menyimpan alasan/aktor/persetujuan dan mempertahankan pembayaran asli', async () => {
    const id = await sale();
    await expect(reverseOrder(id, 2, 2, 'Salah pesanan')).rejects.toThrow('owner');
    await reverseOrder(id, 2, 1, 'Salah pesanan');
    expect((await db.orders.get(id))?.status).toBe('void');
    expect(await db.payments.count()).toBe(1);
    expect(await db.audit.where('action').equals('refund').first()).toMatchObject({ actorId: 2, approverId: 1, reason: 'Salah pesanan', amount: 11000 });
    await expect(reverseOrder(id, 2, 1, 'Ulang refund')).rejects.toThrow();
    await closeShift(1, 2, 0);
    expect((await db.shifts.get(1))?.actualCash).toBe(0);
  });
  it('tutup shift menolak pesanan terbuka dan selisih tanpa persetujuan', async () => {
    const id = await db.orders.add({ ...order, status: 'open' });
    await expect(closeShift(1, 2, 0)).rejects.toThrow('terbuka');
    await db.orders.delete(id); await sale();
    await expect(closeShift(1, 2, 0)).rejects.toThrow('persetujuan');
    await closeShift(1, 2, 11000);
    await expect(commitSale(order, items, { ...payment, requestId: 'new' }, 2, null)).rejects.toThrow('ditutup');
  });
  it('kegagalan penulisan audit membatalkan seluruh pembayaran', async () => {
    const spy = vi.spyOn(db.audit, 'add').mockRejectedValueOnce(new Error('storage full'));
    await expect(sale()).rejects.toThrow('storage full'); spy.mockRestore();
    expect(await db.orders.count()).toBe(0); expect(await db.payments.count()).toBe(0);
  });
});

describe('backup dan pemulihan', () => {
  it('backup valid dapat dipulihkan, membuat salinan lama dan menjeda sync', async () => {
    await sale(); const original = await createBackup();
    await db.products.update(1, { name: 'Menu berubah' });
    await restoreBackup(original);
    expect((await db.products.get(1))?.name).toBe(original.data.products[0].name);
    expect(JSON.parse((await db.recovery.toArray())[0].data).data.products[0].name).toBe('Menu berubah');
    expect((await db.settings.get('sync_paused'))?.value).toBe('true');
  });
  it('file kosong, versi salah, bagian hilang, dan total yang rusak ditolak', async () => {
    await sale(); const backup = await createBackup();
    for (const input of [{}, { ...backup, version: 99 }, { ...backup, data: { ...backup.data, payments: undefined } }, { ...backup, data: { ...backup.data, orders: [{ ...backup.data.orders[0], total: 1 }] } }]) {
      expect(() => parseBackup(JSON.stringify(input))).toThrow('Backup ditolak');
    }
    expect(await db.payments.count()).toBe(1);
  });
  it('kegagalan restore mengembalikan data lama secara atomik', async () => {
    const backup = await createBackup(); await db.products.update(1, { name: 'Harus tetap ada' });
    const spy = vi.spyOn(db.products, 'bulkAdd').mockRejectedValueOnce(new Error('disk full'));
    await expect(restoreBackup(backup)).rejects.toThrow(); spy.mockRestore();
    expect((await db.products.get(1))?.name).toBe('Harus tetap ada');
    expect(await db.recovery.count()).toBe(0);
  });
  it('backup lama lengkap diterima, identitas dan kredensial cloud tidak diimpor', async () => {
    const b = await createBackup();
    const legacy = { ...b.data, settings: [{ key: 'device_id', value: 'other' }, { key: 'supabase_anon_key', value: 'secret' }] };
    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.data.settings).toEqual([]);
  });
});

describe('payload sinkronisasi', () => {
  it('hanya mengirim perubahan dan penghapusan, tidak mengirim hash PIN/status dapur', async () => {
    await sale(); const before = await snapshot('test');
    expect(difference(before, before)).toEqual([]);
    const id = (await db.orderItems.toArray())[0].id!;
    await db.orderItems.delete(id);
    const changes = difference(await snapshot('test'), before);
    expect(changes).toHaveLength(1); expect(changes[0]).toMatchObject({ table: 'order_items', op: 'delete' });
    expect(JSON.stringify(before)).not.toContain('pinHash');
    expect(JSON.stringify(before)).not.toContain('kds_status');
  });
});

describe('PIN', () => {
  it('salt berbeda dan verifikasi PIN benar/salah', async () => {
    const a = await secureHash('987654'); const b = await secureHash('987654');
    expect(a).not.toBe(b); expect(await verifyPin('987654', a)).toBe(true); expect(await verifyPin('000000', a)).toBe(false);
  });
  it('PIN demo dimigrasi dan wajib diganti sebelum otorisasi owner', async () => {
    const owner = await authenticatePin('1234');
    expect(owner.mustChangePin).toBe(true); expect(owner.pinHash).toMatch(/^pbkdf2/);
    await expect(authenticatePin('1234', true)).rejects.toThrow('mengganti');
    await changePin(owner.id!, '987654');
    expect((await authenticatePin('987654', true)).mustChangePin).toBe(false);
  });
  it('lima kesalahan mengunci percobaan berikutnya', async () => {
    for (let i = 0; i < 5; i++) await expect(authenticatePin('0000')).rejects.toThrow('PIN salah');
    await expect(authenticatePin('1234')).rejects.toThrow('Tunggu');
  });
});

describe('pengeluaran dari laci kas', () => {
  it('mengurangi kas yang diharapkan saat tutup shift, dan pembatalan mengembalikannya', async () => {
    await sale(); // tunai 11000
    const { addExpense, voidExpense } = await import('../src/operations');
    const id = await addExpense({ date: '2026-11-11', category: 'Lainnya', description: 'Beli es batu', amount: 5000 }, 1, true);
    expect((await db.expenses.get(id))?.shiftId).toBe(1);
    await addExpense({ date: '2026-11-11', category: 'Listrik', description: 'Token listrik', amount: 50000 }, 1); // bukan dari laci
    await expect(closeShift(1, 2, 11000)).rejects.toThrow('persetujuan');
    await closeShift(1, 2, 6000);
    expect(await db.audit.where('action').equals('shift_close').first()).toMatchObject({ amount: 0 });
    await expect(voidExpense(id, 'Salah catat', 1)).rejects.toThrow('sudah ditutup');
  });
  it('pengeluaran laci yang dibatalkan tidak mengurangi kas; tanpa shift terbuka ditolak', async () => {
    const { addExpense, voidExpense } = await import('../src/operations');
    const id = await addExpense({ date: '2026-11-11', category: 'Lainnya', description: 'Beli es batu', amount: 5000 }, 1, true);
    await voidExpense(id, 'Salah catat', 1);
    await closeShift(1, 2, 0);
    await expect(addExpense({ date: '2026-11-11', category: 'Lainnya', description: 'Beli gas', amount: 5000 }, 1, true)).rejects.toThrow('shift terbuka');
  });
  it('backup dengan shift pengeluaran tidak dikenal ditolak', async () => {
    const { addExpense } = await import('../src/operations');
    await addExpense({ date: '2026-11-11', category: 'Lainnya', description: 'Beli es batu', amount: 5000 }, 1, true);
    const backup = await createBackup();
    expect(() => parseBackup(JSON.stringify(backup))).not.toThrow();
    backup.data.expenses[0].shiftId = 99;
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('pengeluaran');
  });
});

describe('login per staf', () => {
  it('hanya memeriksa PIN staf yang dipilih', async () => {
    await expect(authenticatePin('1234', false, 2)).rejects.toThrow('PIN salah');
    await db.settings.delete('pin_attempts');
    expect((await authenticatePin('1111', false, 2)).name).toBe('Sari');
    await expect(authenticatePin('1111', true, 2)).rejects.toThrow('PIN salah');
  });
});

describe('ack sinkronisasi ringkas', () => {
  it('ack berisi tanda tangan, kompatibel dengan snapshot lama, dan delete hanya berisi identitas', async () => {
    const { acknowledge } = await import('../src/sync-payload');
    await sale(); const before = await snapshot('test');
    const ack = acknowledge(before);
    expect(JSON.stringify(ack).length).toBeLessThan(JSON.stringify(before).length);
    expect(difference(before, ack)).toEqual([]);
    await db.products.update(1, { price: 99000 });
    await db.orderItems.clear();
    const after = await snapshot('test');
    const changes = difference(after, ack, 'test');
    expect(changes).toEqual(difference(after, before, 'test'));
    expect(changes).toContainEqual({ table: 'products', op: 'put', row: expect.objectContaining({ price: 99000 }) });
    expect(changes).toContainEqual({ table: 'order_items', op: 'delete', row: { device_id: 'test', local_id: 1 } });
  });
});

describe('penguncian PIN bertingkat', () => {
  it('kunci makin lama, login benar tidak mereset tingkat, dan reda setelah 6 jam', async () => {
    const { pinLockLog } = await import('../src/auth');
    let now = 1_000_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const fiveWrong = async () => { for (let i = 0; i < 5; i++) await expect(authenticatePin('0000', false, 2)).rejects.toThrow('PIN salah'); };
      await fiveWrong();
      await expect(authenticatePin('1111', false, 2)).rejects.toThrow('Tunggu 1 menit');
      now += 60_001;
      await fiveWrong();
      await expect(authenticatePin('1111', false, 2)).rejects.toThrow('Tunggu 5 menit');
      now += 5 * 60_000 + 1;
      expect((await authenticatePin('1111', false, 2)).name).toBe('Sari'); // login benar
      await fiveWrong();
      await expect(authenticatePin('1111', false, 2)).rejects.toThrow('Tunggu 15 menit');
      expect((await pinLockLog()).map(e => e.level)).toEqual([3, 2, 1]);
      now += 7 * 60 * 60_000;
      await fiveWrong();
      await expect(authenticatePin('1111', false, 2)).rejects.toThrow('Tunggu 1 menit');
    } finally { clock.mockRestore(); }
  }, 60_000);
});

describe('restore backup dengan hash PIN lama', () => {
  it('staf dengan hash lama wajib ganti PIN setelah restore, walau PIN-nya bukan PIN demo', async () => {
    const { hashPin } = await import('../src/db');
    const { legacyPinStaff } = await import('../src/backup');
    await db.staff.update(2, { pinHash: hashPin('4321') });
    await db.staff.update(1, { pinHash: await secureHash('987654') });
    const backup = await createBackup();
    expect(legacyPinStaff(backup)).toEqual(['Sari']);
    await restoreBackup(backup);
    expect((await db.staff.get(1))?.mustChangePin).toBeFalsy();
    const sari = await authenticatePin('4321', false, 2);
    expect(sari.mustChangePin).toBe(true); expect(sari.pinHash).toMatch(/^pbkdf2/);
  });
});
