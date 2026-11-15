import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { saveTable } from '../src/operations';

beforeEach(async () => { await db.delete(); await db.open(); });
afterAll(() => db.close());

const OWNER = 1;

describe('kelola meja', () => {
  it('owner menambah meja baru yang langsung kosong', async () => {
    const id = await saveTable({ name: '  Teras 1 ' }, OWNER);
    expect(await db.meja.get(id)).toMatchObject({ name: 'Teras 1', status: 'available' });
  });

  it('ganti nama mempertahankan status meja', async () => {
    await db.meja.update(1, { status: 'occupied' });
    await saveTable({ id: 1, name: 'VIP' }, OWNER);
    expect(await db.meja.get(1)).toMatchObject({ name: 'VIP', status: 'occupied' });
  });

  it('menolak nama kosong, terlalu panjang, atau kembar (tanpa beda huruf besar)', async () => {
    await expect(saveTable({ name: '   ' }, OWNER)).rejects.toThrow('wajib diisi');
    await expect(saveTable({ name: 'x'.repeat(21) }, OWNER)).rejects.toThrow('maksimal 20');
    await expect(saveTable({ name: 't-01' }, OWNER)).rejects.toThrow('sudah ada');
    await expect(saveTable({ id: 1, name: 'T-01' }, OWNER)).resolves.toBe(1);
  });

  it('hanya owner yang boleh mengubah meja', async () => {
    const kasir = (await db.staff.toArray()).find(s => s.role !== 'owner')!.id!;
    await expect(saveTable({ name: 'Baru' }, kasir)).rejects.toThrow('Hanya owner');
  });
});
