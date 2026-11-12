import type { SupabaseClient } from '@supabase/supabase-js';
import { secureHash } from './auth';
import { parseBackup, restoreBackup, type Backup, type BackupData } from './backup';
import type { Staff } from './types';

/**
 * Pull direction of sync: rebuilds a tablet's local database from what it pushed to the cloud,
 * e.g. onto a replacement tablet. The result goes through the same validation and restore path as a
 * backup file. PIN hashes and tablet-only settings (service charge, QRIS image) are never synced,
 * so every staff member receives a new PIN chosen during the restore.
 */
type Row = Record<string, unknown>;
const PAGE = 500;
const opt = <T,>(v: unknown) => (v ?? undefined) as T | undefined;
const num = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));

async function fetchAll(sb: SupabaseClient, table: string, device: string): Promise<Row[]> {
  const rows: Row[] = [];
  let total = Infinity;
  // Page by count so a lower PostgREST max-rows setting cannot silently truncate the restore.
  while (rows.length < total) {
    const { data, error, count } = await sb.from(table).select('*', { count: 'exact' }).eq('device_id', device).order('local_id').range(rows.length, rows.length + PAGE - 1);
    if (error) throw new Error(`Gagal membaca ${table} dari cloud: ${error.message}`);
    if (count === null) throw new Error(`Jumlah baris ${table} tidak diketahui.`);
    total = count;
    if (!data.length) break;
    rows.push(...(data as Row[]));
  }
  if (rows.length !== total) throw new Error(`Data ${table} berubah saat dibaca. Coba lagi.`);
  return rows;
}

const PLACEHOLDER_HASH = `pbkdf2$${'0'.repeat(32)}$${'0'.repeat(64)}`;

export function cloudRowsToBackup(device: string, t: Record<string, Row[]>, pinHashes: Record<number, string> = {}): Backup {
  const data: BackupData = {
    staff: t.staff.map(r => ({ id: Number(r.local_id), name: String(r.name), role: r.role as Staff['role'], pinHash: pinHashes[Number(r.local_id)] ?? PLACEHOLDER_HASH, mustChangePin: true })),
    shifts: t.shifts.map(r => ({ id: Number(r.local_id), staffId: Number(r.staff_local_id), status: r.status as 'open' | 'closed', openedAt: Number(r.opened_at), openingFloat: Number(r.opening_float ?? 0), closedAt: num(r.closed_at), actualCash: num(r.actual_cash), note: opt<string>(r.note) })),
    products: t.products.map(r => ({ id: Number(r.local_id), name: String(r.name), category: String(r.category ?? 'Lainnya'), price: Number(r.price), active: Number(r.active ?? 1) as 0 | 1, photo: opt<string>(r.photo), soldOut: r.sold_out === true })),
    tables: t.dining_tables.map(r => ({ id: Number(r.local_id), name: String(r.name), status: r.status as 'available' })),
    orders: t.orders.map(r => ({
      id: Number(r.local_id), shiftId: Number(r.shift_local_id), status: r.status as 'paid', createdAt: Number(r.created_at),
      subtotal: Number(r.subtotal), service: Number(r.service), tax: Number(r.tax), total: Number(r.total), orderType: r.order_type as 'dine_in',
      tableId: num(r.table_local_id), cashierId: num(r.cashier_local_id), paidAt: num(r.paid_at),
      costTotal: num(r.cost_total), costComplete: opt<boolean>(r.cost_complete), stockReturned: opt<boolean>(r.stock_returned),
      discount: num(r.discount), discountReason: opt<string>(r.discount_reason), discountApproverId: num(r.discount_approver_local_id), splitFrom: num(r.split_from_local_id),
    })),
    orderItems: t.order_items.map(r => ({ id: Number(r.local_id), orderId: Number(r.order_local_id), productId: Number(r.product_local_id), name: String(r.name), qty: Number(r.qty), price: Number(r.price), costTotal: num(r.cost_total) })),
    payments: t.payments.map(r => ({ id: Number(r.local_id), orderId: Number(r.order_local_id), shiftId: Number(r.shift_local_id), method: r.method as 'cash', amount: Number(r.amount), tendered: Number(r.tendered), change: Number(r.change), createdAt: Number(r.created_at), requestId: opt<string>(r.request_id) })),
    audit: t.audit_events.map(r => ({ id: Number(r.local_id), action: r.action as 'payment', orderId: num(r.order_local_id), shiftId: Number(r.shift_local_id), actorId: Number(r.actor_local_id), approverId: num(r.approver_local_id), reason: String(r.reason), amount: Number(r.amount), createdAt: Number(r.created_at) })),
    ingredients: t.ingredients.map(r => ({ id: Number(r.local_id), name: String(r.name), unit: r.unit as 'g', stock: Number(r.stock), minimum: Number(r.minimum), unitCost: Number(r.unit_cost), active: Number(r.active) as 0 | 1 })),
    recipes: t.recipes.map(r => ({ productId: Number(r.local_id), ingredients: r.ingredients as { ingredientId: number; qty: number }[] })),
    stockMovements: t.stock_movements.map(r => ({ id: Number(r.local_id), ingredientId: Number(r.ingredient_local_id), orderId: num(r.order_local_id), kind: r.kind as 'sale', qty: Number(r.qty), unitCost: Number(r.unit_cost), reason: String(r.reason), actorId: Number(r.actor_local_id), createdAt: Number(r.created_at) })),
    expenses: t.expenses.map(r => ({ id: Number(r.local_id), date: String(r.date), category: String(r.category), description: String(r.description), amount: Number(r.amount), actorId: Number(r.actor_local_id), createdAt: Number(r.created_at), voidedAt: num(r.voided_at), voidReason: opt<string>(r.void_reason), shiftId: num(r.shift_local_id) })),
    settings: [],
  };
  return parseBackup(JSON.stringify({ format: 'kedai-rakdjat', version: 3, createdAt: Date.now(), sourceDevice: device, data }));
}

const TABLES = ['staff', 'shifts', 'products', 'dining_tables', 'orders', 'order_items', 'payments', 'audit_events', 'ingredients', 'recipes', 'stock_movements', 'expenses'];
export interface CloudPreview { device: string; rows: Record<string, Row[]>; staff: Pick<Staff, 'id' | 'name' | 'role'>[]; orders: number; lastActivity: number }

/** Downloads and validates a device's cloud data. Requires an owner membership (owners can read every table). */
export async function previewCloudRestore(sb: SupabaseClient, device: string): Promise<CloudPreview> {
  const member = await sb.from('cloud_memberships').select('role').eq('device_id', device);
  if (member.error) throw new Error(member.error.message);
  if (!member.data?.some(m => m.role === 'owner')) throw new Error('Pemulihan dari cloud membutuhkan akun cloud owner untuk perangkat ini.');
  const rows: Record<string, Row[]> = {};
  for (const table of TABLES) rows[table] = await fetchAll(sb, table, device);
  if (!rows.staff.length) throw new Error('Cloud belum memiliki data untuk perangkat ini.');
  const backup = cloudRowsToBackup(device, rows);
  const times = [...backup.data.orders.map(o => o.createdAt), ...backup.data.payments.map(p => p.createdAt), ...backup.data.shifts.map(s => s.closedAt ?? s.openedAt)];
  return { device, rows, staff: backup.data.staff.map(({ id, name, role }) => ({ id, name, role })), orders: backup.data.orders.length, lastActivity: times.length ? Math.max(...times) : 0 };
}

/** Sets a new PIN for every staff member, then replaces local data and adopts the cloud device identity. */
export async function applyCloudRestore(preview: CloudPreview, pins: Record<number, string>) {
  const values = preview.staff.map(s => pins[s.id!] ?? '');
  if (values.some(p => !/^\d{4,6}$/.test(p))) throw new Error('Isi PIN baru 4–6 angka untuk setiap staf.');
  if (values.some(p => p === '1111' || p === '1234')) throw new Error('Gunakan PIN selain PIN demo.');
  if (new Set(values).size !== values.length) throw new Error('Setiap staf harus memiliki PIN berbeda.');
  const hashes: Record<number, string> = {};
  for (const s of preview.staff) hashes[s.id!] = await secureHash(pins[s.id!]);
  await restoreBackup(cloudRowsToBackup(preview.device, preview.rows, hashes), { adoptDevice: preview.device });
}
