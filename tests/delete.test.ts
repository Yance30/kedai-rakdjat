import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { addStaff, changePin, deleteStaff } from '../src/auth';
import { deleteProduct } from '../src/operations';

beforeEach(async () => { await db.delete(); await db.open(); await changePin(1, '246810'); });
afterAll(() => db.close());
const OWNER = 1;

describe('hapus menu', () => {
  it('menghapus menu yang belum pernah terjual beserta resepnya', async () => {
    const id = (await db.products.toArray())[0].id!;
    await db.recipes.put({ productId: id, ingredients: [{ ingredientId: 1, qty: 5 }] });
    expect(await deleteProduct(id, OWNER)).toBe('deleted');
    expect(await db.products.get(id)).toBeUndefined();
    expect(await db.recipes.get(id)).toBeUndefined();
  });
  it('mengarsipkan menu yang pernah terjual agar laporan tetap utuh', async () => {
    const id = (await db.products.toArray())[0].id!;
    await db.orderItems.add({ orderId: 1, productId: id, name: 'X', qty: 1, price: 1000 });
    expect(await deleteProduct(id, OWNER)).toBe('archived');
    expect((await db.products.get(id))?.active).toBe(0);
  });
  it('hanya owner', async () => {
    const kasir = await addStaff({ name: 'Kasir Baru', role: 'kasir', pin: '135790' }, OWNER);
    const id = (await db.products.toArray())[0].id!;
    await expect(deleteProduct(id, kasir)).rejects.toThrow('Hanya owner');
  });
});

describe('hapus staf', () => {
  it('menghapus akun yang belum pernah dipakai', async () => {
    const id = await addStaff({ name: 'Calon Kasir', role: 'kasir', pin: '135790' }, OWNER);
    expect(await deleteStaff(id, OWNER)).toBe('deleted');
    expect(await db.staff.get(id)).toBeUndefined();
  });
  it('menonaktifkan staf yang punya riwayat shift', async () => {
    const id = await addStaff({ name: 'Kasir Lama', role: 'kasir', pin: '135790' }, OWNER);
    await db.shifts.add({ staffId: id, status: 'closed', openedAt: 1, openingFloat: 0, closedAt: 2 });
    expect(await deleteStaff(id, OWNER)).toBe('deactivated');
    expect((await db.staff.get(id))?.active).toBe(false);
  });
  it('tidak bisa menghapus diri sendiri', async () => {
    await expect(deleteStaff(OWNER, OWNER)).rejects.toThrow('sendiri');
  });
});
