import { rangeBounds } from './reports';
import { db } from './db';
import { deviceId } from './supabase';
import { exclusive } from './sync';
import type { AuditEvent, DiningTable, Order, OrderItem, Payment, Product, Setting, Shift, Staff } from './types';
import type { Ingredient, Recipe, StockMovement, Expense } from './types';

export interface BackupData { staff: Staff[]; shifts: Shift[]; products: Product[]; orders: Order[]; orderItems: OrderItem[]; payments: Payment[]; settings: Setting[]; tables: DiningTable[]; audit: AuditEvent[]; ingredients: Ingredient[]; recipes: Recipe[]; stockMovements: StockMovement[]; expenses: Expense[] }
export interface Backup { format: 'kedai-rakdjat'; version: 1 | 2 | 3; createdAt: number; sourceDevice: string; data: BackupData }
const businessTables = () => [db.staff, db.shifts, db.products, db.orders, db.orderItems, db.payments, db.settings, db.meja, db.audit, db.ingredients, db.recipes, db.stockMovements, db.expenses];
const settingKeys = new Set(['service_charge', 'qris_image']);
export async function createBackup(): Promise<Backup> {
  const sourceDevice = await deviceId();
  return db.transaction('r', businessTables(), async () => ({
    format: 'kedai-rakdjat' as const, version: 3 as const, createdAt: Date.now(), sourceDevice,
    data: {
      staff: await db.staff.toArray(), shifts: await db.shifts.toArray(), products: await db.products.toArray(),
      orders: await db.orders.toArray(), orderItems: await db.orderItems.toArray(), payments: await db.payments.toArray(),
      settings: (await db.settings.toArray()).filter(s => settingKeys.has(s.key)), tables: await db.meja.toArray(), audit: await db.audit.toArray(),
      ingredients: await db.ingredients.toArray(), recipes: await db.recipes.toArray(), stockMovements: await db.stockMovements.toArray(), expenses:await db.expenses.toArray(),
    },
  }));
}
export const isLegacyHash = (hash: string) => !hash.startsWith('pbkdf2$');
/** Staff whose PIN hash in this backup uses the old weak format (they must set a new PIN after restore). */
export const legacyPinStaff = (backup: Backup) => backup.data.staff.filter(s => isLegacyHash(s.pinHash)).map(s => s.name);
function fail(message: string): never { throw new Error(`Backup ditolak: ${message}`); }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const string = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export function parseBackup(text: string): Backup {
  if (text.length > 30_000_000) fail('ukuran melebihi 30 MB.');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { fail('file bukan JSON yang valid.'); }
  if (!object(raw)) fail('format tidak dikenal.');
  let backup: Record<string, unknown> = raw;
  if (!('format' in raw)) {
    // Strict compatibility with complete exports from the previous version.
    backup = { format: 'kedai-rakdjat', version: 1, createdAt: Date.now(), sourceDevice: 'legacy', data: { ...raw, audit: [] } };
  }
  if (backup.format !== 'kedai-rakdjat' || ![1, 2, 3].includes(backup.version as number) || !integer(backup.createdAt, 1) || !string(backup.sourceDevice) || !object(backup.data)) fail('versi atau metadata tidak didukung.');
  const data = backup.data as Record<string, unknown>;
  if (backup.version === 1) { data.ingredients = []; data.recipes = []; data.stockMovements = []; }
  if (backup.version !== 3) data.expenses=[];
  const ids: Record<string, Set<number>> = {};
  for (const key of ['staff', 'shifts', 'products', 'orders', 'orderItems', 'payments', 'tables', 'audit', 'ingredients', 'stockMovements', 'expenses']) {
    if (!Array.isArray(data[key])) fail(`bagian ${key} tidak lengkap.`);
    ids[key] = new Set();
    for (const row of data[key] as unknown[]) {
      if (!object(row) || !integer(row.id, 1) || ids[key].has(row.id)) fail(`ID ${key} tidak valid / duplikat.`);
      ids[key].add(row.id as number);
    }
  }
  if (!Array.isArray(data.settings)) fail('pengaturan tidak lengkap.');
  for (const row of data.settings as unknown[]) if (!object(row) || !string(row.key) || typeof row.value !== 'string') fail('pengaturan tidak valid.');
  const d = data as unknown as BackupData;
  for (const s of d.staff) if (!string(s.name) || !['owner', 'kasir'].includes(s.role) || !/^(?:[a-f0-9]{1,8}|pbkdf2\$[a-f0-9]{32}\$[a-f0-9]{64})$/.test(s.pinHash) || (s.mustChangePin !== undefined && typeof s.mustChangePin !== 'boolean')) fail('staf/PIN tidak valid.');
  if (!d.staff.some(s => s.role === 'owner')) fail('akun owner wajib ada.');
  for (const s of d.shifts) if (!ids.staff.has(s.staffId) || !['open', 'closed'].includes(s.status) || !integer(s.openedAt, 1) || !integer(s.openingFloat) || (s.status === 'closed' && (!integer(s.closedAt, 1) || !integer(s.actualCash)))) fail('shift tidak valid.');
  if (d.shifts.filter(s => s.status === 'open').length > 1) fail('lebih dari satu shift terbuka.');
  for (const p of d.products) if (!string(p.name) || !string(p.category) || !integer(p.price, 1) || ![0, 1].includes(p.active)) fail('menu tidak valid.');
  for (const t of d.tables) if (!string(t.name) || !['available', 'occupied', 'cleaning'].includes(t.status)) fail('meja tidak valid.');
  for (const o of d.orders) {
    if (!ids.shifts.has(o.shiftId) || !['open', 'paid', 'void'].includes(o.status) || !['dine_in', 'takeaway'].includes(o.orderType) || !integer(o.createdAt, 1) || [o.subtotal, o.service, o.tax, o.total].some(v => !integer(v)) || o.total !== o.subtotal - (o.discount ?? 0) + o.service + o.tax || (o.tableId !== undefined && !ids.tables.has(o.tableId))) fail('pesanan tidak valid.');
    const items = d.orderItems.filter(i => i.orderId === o.id);
    if (!items.length || items.reduce((s, i) => s + i.qty * i.price, 0) !== o.subtotal) fail('rincian pesanan tidak cocok dengan total.');
  }
  for (const i of d.orderItems) if (!ids.orders.has(i.orderId) || !integer(i.productId, 1) || !string(i.name) || !integer(i.qty, 1) || !integer(i.price)) fail('item pesanan tidak valid.');
  const paid = new Set<number>(); const requests = new Set<string>();
  for (const p of d.payments) {
    const order = d.orders.find(o => o.id === p.orderId);
    if (!order || order.status === 'open' || p.shiftId !== order.shiftId || paid.has(p.orderId) || !['cash', 'qris'].includes(p.method) || !integer(p.amount) || !integer(p.tendered) || !integer(p.change) || p.amount !== order.total || p.tendered - p.amount !== p.change || !integer(p.createdAt, 1) || (p.method === 'qris' && p.change !== 0)) fail('pembayaran tidak valid / duplikat.');
    paid.add(p.orderId);
    if (p.requestId !== undefined) { if (!string(p.requestId) || requests.has(p.requestId)) fail('ID pembayaran duplikat.'); requests.add(p.requestId); }
  }
  if (d.orders.some(o => o.status === 'paid' && !paid.has(o.id!))) fail('pesanan lunas tanpa pembayaran.');
  for (const a of d.audit) if (!['payment', 'refund', 'void', 'shift_close', 'receipt_copy', 'discount'].includes(a.action) || !ids.shifts.has(a.shiftId) || !ids.staff.has(a.actorId) || (a.orderId !== undefined && !ids.orders.has(a.orderId)) || (a.approverId !== undefined && !d.staff.some(s => s.id === a.approverId && s.role === 'owner')) || !string(a.reason) || !Number.isSafeInteger(a.amount) || !integer(a.createdAt, 1) || (['refund', 'void','discount'].includes(a.action) && !a.approverId)) fail('jejak audit tidak valid.');
  for (const i of d.ingredients) if (!string(i.name) || !['g','ml','pcs'].includes(i.unit) || !integer(i.stock) || !integer(i.minimum) || typeof i.unitCost !== 'number' || !Number.isFinite(i.unitCost) || i.unitCost < 0 || ![0,1].includes(i.active)) fail('bahan tidak valid.');
  if (!Array.isArray(d.recipes)) fail('resep tidak lengkap.');
  const recipeIds = new Set<number>();
  for (const r of d.recipes) {
    if (!object(r) || !ids.products.has(r.productId) || recipeIds.has(r.productId) || !Array.isArray(r.ingredients) || !r.ingredients.length) fail('resep tidak valid.');
    recipeIds.add(r.productId);
    const used = new Set<number>();
    for (const p of r.ingredients) { if (!object(p) || !ids.ingredients.has(p.ingredientId) || !integer(p.qty,1) || used.has(p.ingredientId)) fail('bahan resep tidak valid.'); used.add(p.ingredientId); }
  }
  for (const m of d.stockMovements) if (!ids.ingredients.has(m.ingredientId) || !ids.staff.has(m.actorId) || !['opening','purchase','adjustment','sale','return','waste','stocktake'].includes(m.kind) || !Number.isSafeInteger(m.qty) || !Number.isFinite(m.unitCost) || m.unitCost < 0 || !string(m.reason) || !integer(m.createdAt,1) || (m.orderId !== undefined && !ids.orders.has(m.orderId))) fail('pergerakan stok tidak valid.');
  for (const i of d.ingredients) if (d.stockMovements.filter(m => m.ingredientId === i.id).reduce((sum,m) => sum + m.qty,0) !== i.stock) fail('saldo stok tidak cocok dengan riwayat.');
  for (const o of d.orders) if ((o.costTotal !== undefined && !integer(o.costTotal)) || (o.costComplete !== undefined && typeof o.costComplete !== 'boolean') || (o.stockReturned !== undefined && typeof o.stockReturned !== 'boolean')) fail('harga pokok pesanan tidak valid.');
  for (const e of d.expenses) if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(Date.parse(e.date+'T00:00:00+07:00')) || !string(e.category) || !string(e.description) || !integer(e.amount,1) || !ids.staff.has(e.actorId) || !integer(e.createdAt,1) || (e.voidedAt !== undefined && (!integer(e.voidedAt,1) || !string(e.voidReason))) || (e.shiftId !== undefined && !ids.shifts.has(e.shiftId))) fail('pengeluaran tidak valid.');
  for (const o of d.orders) if (!integer(o.discount ?? 0) || (o.discount ?? 0) >= o.subtotal || ((o.discount ?? 0)>0 && (!string(o.discountReason) || !d.staff.some(s=>s.id===o.discountApproverId && s.role==='owner')))) fail('diskon tidak valid.');
  for (const e of d.expenses) { try { rangeBounds(e.date,e.date); } catch { fail('tanggal pengeluaran tidak valid.'); } }
  // Credentials, sync metadata and device identity must never be imported.
  d.settings = d.settings.filter(s => settingKeys.has(s.key));
  return backup as unknown as Backup;
}
export async function restoreBackup(input: Backup) {
  const backup = parseBackup(JSON.stringify(input));
  return exclusive(async () => {
    const before = await createBackup();
    return db.transaction('rw', [...businessTables(), db.recovery, db.drafts], async () => {
      // Capture under the write transaction too, so another tab cannot slip a sale between backup and replacement.
      const recovery = await createBackup();
      await db.recovery.add({ createdAt: Date.now(), data: JSON.stringify(recovery) });
      const d = backup.data;
      for (const t of businessTables()) if (t !== db.settings) await t.clear();
      // Legacy 32-bit PIN hashes are trivially reversible from the backup file, so those PINs must be replaced.
      await db.staff.bulkAdd(d.staff.map(s => isLegacyHash(s.pinHash) ? { ...s, mustChangePin: true } : s)); await db.shifts.bulkAdd(d.shifts); await db.products.bulkAdd(d.products);
      await db.orders.bulkAdd(d.orders); await db.orderItems.bulkAdd(d.orderItems); await db.payments.bulkAdd(d.payments);
      await db.meja.bulkAdd(d.tables); await db.audit.bulkAdd(d.audit);
      await db.ingredients.bulkAdd(d.ingredients); await db.recipes.bulkAdd(d.recipes); await db.stockMovements.bulkAdd(d.stockMovements);
      await db.expenses.bulkAdd(d.expenses);
      await db.settings.delete('last_backup_download');
      await db.drafts.clear();
      for (const key of settingKeys) await db.settings.delete(key);
      await db.settings.bulkPut(d.settings);
      await db.settings.put({ key: 'device_id', value: before.sourceDevice });
      await db.settings.put({ key: 'sync_paused', value: 'true' });
      await db.settings.put({ key: 'data_generation', value: crypto.randomUUID() });
    });
  });
}
export function downloadBackup(value: unknown, name = 'backup') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `kedai-rakdjat-${name}-${Date.now()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
