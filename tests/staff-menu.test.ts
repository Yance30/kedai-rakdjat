import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db, hashPin } from '../src/db';
import { addStaff, authenticatePin, changePin, resetStaffPin, updateStaff } from '../src/auth';
import { DEMO_PRODUCT_NAMES, MENU_PRODUCTS } from '../src/menu-seed';

beforeEach(async () => { await db.delete(); await db.open(); });
afterAll(() => db.close());

async function ownerReady() {
  await changePin(1, '246810');
  return 1;
}

describe('menu Kedai Rakdjat', () => {
  it('tablet baru langsung berisi menu cetak kedai dengan harga rupiah penuh', async () => {
    const products = await db.products.toArray();
    expect(products).toHaveLength(MENU_PRODUCTS.length);
    expect(products.find(p => p.name === 'Kopi Rakdjat')).toMatchObject({ category: 'Coffee', price: 17000, active: 1 });
    expect(products.find(p => p.name === 'Chocolate (Ice)')?.price).toBe(18000);
    expect(products.find(p => p.name === 'Jasmine Tea (Hot)')?.price).toBe(8000);
    expect(products.find(p => p.name === 'Chicken Wings Rice Bowl')).toMatchObject({ category: 'Main Course', price: 20000 });
    expect(products.some(p => DEMO_PRODUCT_NAMES.includes(p.name))).toBe(false);
  });

  it('tablet lama: menu demo diarsipkan (riwayat tetap utuh), menu asli ditambahkan, nama staf demo diganti', async () => {
    db.close();
    await Dexie.delete('kedai-rakdjat-pos');
    const old = new Dexie('kedai-rakdjat-pos');
    old.version(7).stores({ staff: '++id, role, pinHash', products: '++id, category, active', orderItems: '++id, orderId', settings: 'key' });
    await old.open();
    await old.table('staff').bulkAdd([{ name: 'Budi Santoso', role: 'owner', pinHash: hashPin('1234') }, { name: 'Sari', role: 'kasir', pinHash: hashPin('1111') }, { name: 'Dewi', role: 'kasir', pinHash: hashPin('2468') }]);
    await old.table('products').bulkAdd([{ name: 'Nasi Lemak Spesial', category: 'Food', price: 35000, active: 1 }, { name: 'Espresso', category: 'Coffee', price: 9000, active: 1 }]);
    await old.table('orderItems').add({ orderId: 1, productId: 1, name: 'Nasi Lemak Spesial', qty: 1, price: 35000 });
    old.close();
    await db.open();
    const products = await db.products.toArray();
    expect(products.find(p => p.name === 'Nasi Lemak Spesial')?.active).toBe(0);
    expect(products.filter(p => p.name === 'Espresso')).toHaveLength(1); // existing item kept, not duplicated
    expect(products.filter(p => p.active)).toHaveLength(MENU_PRODUCTS.length);
    expect((await db.staff.toArray()).map(s => s.name)).toEqual(['Owner', 'Kasir', 'Dewi']);
    expect(await db.orderItems.count()).toBe(1);
  });
});

describe('login PIN saja & staf dari owner', () => {
  it('PIN saja mengenali staf yang tepat tanpa memilih nama', async () => {
    await ownerReady();
    expect((await authenticatePin('246810')).role).toBe('owner');
    expect((await authenticatePin('1111')).name).toBe('Kasir');
    await expect(authenticatePin('999999')).rejects.toThrow('PIN salah');
  });

  it('owner menambah staf shift; staf wajib membuat PIN pribadi saat login pertama', async () => {
    const owner = await ownerReady();
    const id = await addStaff({ name: '  Rina  Putri ', role: 'kasir', pin: '5555' }, owner);
    const rina = await authenticatePin('5555');
    expect(rina).toMatchObject({ id, name: 'Rina Putri', role: 'kasir', mustChangePin: true });
    await changePin(id, '135790');
    expect((await authenticatePin('135790')).mustChangePin).toBe(false);
    await expect(authenticatePin('5555')).rejects.toThrow('PIN salah');
  });

  it('PIN tidak boleh sama dengan staf lain karena login hanya memakai PIN', async () => {
    const owner = await ownerReady();
    await expect(addStaff({ name: 'Rina', role: 'kasir', pin: '246810' }, owner)).rejects.toThrow('sudah digunakan');
    await expect(addStaff({ name: 'Rina', role: 'kasir', pin: '1111' }, owner)).rejects.toThrow('demo');
  });

  it('staf nonaktif tidak bisa login, tetapi datanya tetap ada; aktif kembali bisa login', async () => {
    const owner = await ownerReady();
    const id = await addStaff({ name: 'Rina', role: 'kasir', pin: '5555' }, owner);
    await updateStaff(id, { active: false }, owner);
    await expect(authenticatePin('5555')).rejects.toThrow('PIN salah');
    expect(await db.staff.get(id)).toBeDefined();
    await updateStaff(id, { active: true }, owner);
    expect((await authenticatePin('5555')).id).toBe(id);
  });

  it('hanya owner yang dapat mengelola staf, dan owner aktif terakhir tidak bisa dihapus aksesnya', async () => {
    const owner = await ownerReady();
    await expect(addStaff({ name: 'Rina', role: 'kasir', pin: '5555' }, 2)).rejects.toThrow('Hanya owner');
    await expect(updateStaff(owner, { active: false }, owner)).rejects.toThrow('sendiri');
    const second = await addStaff({ name: 'Owner Dua', role: 'owner', pin: '8642' }, owner);
    await updateStaff(owner, { role: 'kasir' }, second);
    await expect(updateStaff(second, { role: 'kasir' }, second)).rejects.toThrow('sendiri');
  });

  it('reset PIN oleh owner untuk staf yang lupa: PIN sementara wajib diganti', async () => {
    const owner = await ownerReady();
    await resetStaffPin(2, '7777', owner);
    expect((await authenticatePin('7777')).mustChangePin).toBe(true);
    await expect(authenticatePin('1111')).rejects.toThrow('PIN salah');
  });
});
