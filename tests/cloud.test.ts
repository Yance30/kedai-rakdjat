import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

let pg: PGlite;
const owner = '00000000-0000-0000-0000-000000000001';
const cashier = '00000000-0000-0000-0000-000000000002';
const kitchen = '00000000-0000-0000-0000-000000000003';
const outsider = '00000000-0000-0000-0000-000000000004';
async function login(user: string) {
  await pg.exec('reset role');
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await pg.exec('set role authenticated');
}
const row = (table: string, data: Record<string, unknown>, op = 'put') => ({ table, op, row: { device_id: 'tablet-a', local_id: 1, ...data } });
const order = row('orders', { shift_local_id: 1, status: 'open', created_at: 1000, subtotal: 10000, service: 0, tax: 1000, total: 11000, order_type: 'dine_in', table_local_id: 1 });
async function push(changes: unknown[], device = 'tablet-a', full = false) { await pg.query('select public.apply_pos_changes($1, $2::jsonb, $3)', [device, JSON.stringify(changes), full]); }
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${owner}'),('${cashier}'),('${kitchen}'),('${outsider}');`);
  await pg.exec(readFileSync('supabase/migrations/0001_init.sql', 'utf8'));
  await pg.exec(readFileSync('supabase/migrations/0002_secure_sync.sql', 'utf8'));
  await pg.exec(readFileSync('supabase/migrations/0003_inventory_reporting.sql', 'utf8'));
  await pg.exec(readFileSync('supabase/migrations/0004_operations.sql', 'utf8'));
  await pg.exec(readFileSync('supabase/migrations/0005_drawer_expenses.sql', 'utf8'));
  await pg.exec(`insert into public.cloud_memberships values ('${owner}','tablet-a','owner'),('${cashier}','tablet-a','cashier'),('${kitchen}','tablet-a','kitchen'),('${outsider}','tablet-b','owner')`);
});
afterAll(async () => { await pg.close(); });
it('pengeluaran dan diskon memakai schema baru dan akses biaya hanya owner',async()=>{
  await login(owner);
  const expense=row('expenses',{date:'2026-11-11',category:'Listrik',description:'Token listrik',amount:50000,actor_local_id:1,created_at:1000});
  await push([expense]);
  expect((await pg.query('select amount from public.expenses')).rows).toHaveLength(1);
  await login(cashier);
  expect((await pg.query('select * from public.expenses')).rows).toHaveLength(0);
  await expect(push([expense])).rejects.toThrow('owner');
  await expect(pg.query("select public.apply_pos_changes_v3('tablet-a','[]',false)")).rejects.toThrow('permission denied');
  await login(owner);
  await push([row('orders',{...order.row,local_id:99,discount:1000,discount_reason:'Promo owner',discount_approver_local_id:1,total:10000})]);
  await expect(push([row('orders',{...order.row,local_id:99,discount:2000,total:10000})])).rejects.toThrow();
});
describe('migrasi SQL dan akses cloud', () => {
  it('anon tidak bisa membaca atau menjalankan sinkronisasi', async () => {
    await pg.exec('set role anon');
    await expect(pg.query('select * from public.orders')).rejects.toThrow('permission denied');
    await expect(push([order])).rejects.toThrow('permission denied');
  });
  it('owner dapat bootstrap data dan hanya melihat membership miliknya', async () => {
    await login(owner);
    await push([order, row('order_items', { order_local_id: 1, product_local_id: 1, name: 'Kopi', qty: 1, price: 10000 }), row('products', { name: 'Kopi', category: 'Drink', price: 10000, active: 1 })], 'tablet-a', true);
    expect((await pg.query('select * from public.cloud_memberships')).rows).toHaveLength(1);
    expect((await pg.query('select * from public.orders')).rows).toHaveLength(1);
  });
  it('pengguna perangkat lain tidak bisa membaca atau menulis data tablet-a', async () => {
    await login(outsider);
    expect((await pg.query('select * from public.orders')).rows).toHaveLength(0);
    await expect(push([order])).rejects.toThrow('Tidak berhak');
    await expect(push([order], 'tablet-b')).rejects.toThrow('tidak cocok');
  });
  it('dapur hanya dapat mengubah progres melalui RPC, bukan total pembayaran', async () => {
    await login(kitchen);
    expect((await pg.query('select * from public.orders')).rows).toHaveLength(1);
    expect((await pg.query('select * from public.payments')).rows).toHaveLength(0);
    await expect(pg.exec("update public.orders set total=1")).rejects.toThrow('permission denied');
    await expect(push([order])).rejects.toThrow('Tidak berhak');
    await pg.query("select public.advance_kitchen('tablet-a',1,'incoming','cooking')");
    await expect(pg.query("select public.advance_kitchen('tablet-a',1,'incoming','ready')")).rejects.toThrow();
  });
  it('sync ulang idempoten dan tidak menimpa status dapur', async () => {
    await login(owner); await push([order]); await push([order]);
    const result = await pg.query<{ kds_status: string }>('select kds_status from public.orders');
    expect(result.rows).toEqual([{ kds_status: 'cooking' }]);
  });
  it('kasir tidak bisa mengubah menu, membership, atau audit server', async () => {
    await login(cashier);
    await expect(push([row('products', { name: 'Hack', price: 1 })])).rejects.toThrow('owner');
    await expect(pg.exec("update public.cloud_memberships set role='owner'")).rejects.toThrow('permission denied');
    await expect(pg.exec('truncate public.cloud_memberships')).rejects.toThrow('permission denied');
    await expect(pg.exec('delete from public.cloud_change_log')).rejects.toThrow('permission denied');
    await expect(pg.query("select public.advance_kitchen('tablet-a',1,'cooking','ready')")).rejects.toThrow('ditolak');
  });
  it('hapus item tersinkron dan kegagalan batch membatalkan semua perubahan', async () => {
    await login(owner);
    await expect(push([row('order_items', {}, 'delete'), { table: 'cloud_memberships', op: 'delete', row: {} }])).rejects.toThrow('Tabel');
    expect((await pg.query('select * from public.order_items')).rows).toHaveLength(1);
    await push([row('order_items', {}, 'delete')]);
    expect((await pg.query('select * from public.order_items')).rows).toHaveLength(0);
  });
  it('bootstrap membersihkan baris lama yang tertinggal dari versi MVP', async () => {
    await push([row('order_items', { local_id: 99, order_local_id: 1, product_local_id: 1, name: 'Lama', qty: 1, price: 10000 })]);
    await push([order], 'tablet-a', true);
    expect((await pg.query('select * from public.order_items')).rows).toHaveLength(0);
    expect((await pg.query('select * from public.cloud_change_log')).rows.length).toBeGreaterThan(0);
  });
  it('schema stok aktif, owner dapat membuat bahan, kasir memotong stok secara atomik dan idempoten', async () => {
    await login(owner);
    expect((await pg.query<{pos_schema_version:number}>('select public.pos_schema_version()')).rows[0].pos_schema_version).toBe(5);
    const ingredient=row('ingredients',{name:'Kopi',unit:'g',stock:1000,minimum:100,unit_cost:100,active:1});
    await push([ingredient,row('recipes',{ingredients:[{ingredientId:1,qty:20}]}),row('stock_movements',{ingredient_local_id:1,order_local_id:null,kind:'opening',qty:1000,unit_cost:100,reason:'Stok awal',actor_local_id:1,created_at:1000})]);
    await login(cashier);
    const paid={...order,row:{...order.row,status:'paid',cost_total:2000,cost_complete:true,cashier_local_id:2,paid_at:2000}};
    const stock={...ingredient,row:{...ingredient.row,stock:980}};
    const sale=row('stock_movements',{local_id:2,ingredient_local_id:1,order_local_id:1,kind:'sale',qty:-20,unit_cost:100,reason:'Penjualan #1',actor_local_id:2,created_at:2000});
    await push([paid,stock,sale]);await push([paid,stock,sale]);
    expect((await pg.query<{stock:number}>('select stock from public.ingredients')).rows[0].stock).toBe(980);
    expect((await pg.query('select * from public.stock_movements')).rows).toHaveLength(2);
    await expect(push([{...ingredient,row:{...ingredient.row,stock:999}}])).rejects.toThrow('Stok tidak cocok');
    await expect(push([row('recipes',{ingredients:[]})])).rejects.toThrow('owner');
    await expect(pg.query("select public.apply_pos_changes_v2('tablet-a','[]',false)")).rejects.toThrow('permission denied');
    await login(kitchen);expect((await pg.query('select * from public.ingredients')).rows).toHaveLength(0);
  });
});
it('pengeluaran dari laci kas menyimpan dan memperbarui shift_local_id', async () => {
  await login(owner);
  const expense = row('expenses', { local_id: 7, date: '2026-11-11', category: 'Lainnya', description: 'Beli es batu', amount: 5000, actor_local_id: 1, created_at: 1000 });
  await push([expense]);
  await push([{ ...expense, row: { ...expense.row, shift_local_id: 3 } }]);
  expect((await pg.query<{ shift_local_id: number }>('select shift_local_id from public.expenses where local_id=7')).rows[0].shift_local_id).toBe(3);
});
