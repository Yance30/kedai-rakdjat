import { db } from './db';
export type Snapshot = Record<string, Record<string, unknown>[]>;
export async function snapshot(dev: string): Promise<Snapshot> {
  return db.transaction('r', [db.staff, db.shifts, db.products, db.meja, db.orders, db.orderItems, db.payments, db.audit, db.ingredients, db.recipes, db.stockMovements, db.expenses], async () => {
    const [staff, shifts, products, tables, orders, orderItems, payments, audit] = await Promise.all([
      db.staff.toArray(), db.shifts.toArray(), db.products.toArray(), db.meja.toArray(), db.orders.toArray(), db.orderItems.toArray(), db.payments.toArray(), db.audit.toArray(),
    ]);
    const result: Snapshot = {};
    const collect = (table: string, rows: Record<string, unknown>[]) => { result[table] = rows; };
    collect('staff', staff.map((s) => ({ device_id: dev, local_id: s.id, name: s.name, role: s.role })));
    collect('shifts', shifts.map((s) => ({
      device_id: dev, local_id: s.id, staff_local_id: s.staffId, status: s.status,
      opened_at: s.openedAt, opening_float: s.openingFloat, closed_at: s.closedAt ?? null,
      actual_cash: s.actualCash ?? null, note: s.note ?? null,
    })));
    collect('products', products.map((p) => ({
      device_id: dev, local_id: p.id, name: p.name, category: p.category, price: p.price, active: p.active, photo: p.photo ?? null, sold_out: p.soldOut ?? false,
    })));
    collect('dining_tables', tables.map((t) => ({ device_id: dev, local_id: t.id, name: t.name, status: t.status })));
    // kds_status intentionally omitted so kitchen updates in cloud are not overwritten.
    collect('orders', orders.map((o) => ({
      device_id: dev, local_id: o.id, shift_local_id: o.shiftId, status: o.status, created_at: o.createdAt,
      discount:o.discount ?? 0, discount_reason:o.discountReason ?? null, discount_approver_local_id:o.discountApproverId ?? null,
      subtotal: o.subtotal, service: o.service, tax: o.tax, total: o.total, order_type: o.orderType,
      table_local_id: o.tableId ?? null,
      cashier_local_id: o.cashierId ?? null, paid_at: o.paidAt ?? null,
      cost_total: o.costTotal ?? null, cost_complete: o.costComplete ?? null, stock_returned: o.stockReturned ?? null,
      split_from_local_id: o.splitFrom ?? null,
    })));
    collect('order_items', orderItems.map((i) => ({
      device_id: dev, local_id: i.id, order_local_id: i.orderId, product_local_id: i.productId,
      name: i.name, qty: i.qty, price: i.price,
      cost_total: i.costTotal ?? null,
    })));
    collect('payments', payments.map((p) => ({
      device_id: dev, local_id: p.id, order_local_id: p.orderId, shift_local_id: p.shiftId,
      method: p.method, amount: p.amount, tendered: p.tendered, change: p.change, created_at: p.createdAt, request_id: p.requestId ?? null,
    })));


    collect('audit_events', audit.map(a => ({ device_id: dev, local_id: a.id, action: a.action, order_local_id: a.orderId ?? null, shift_local_id: a.shiftId, actor_local_id: a.actorId, approver_local_id: a.approverId ?? null, reason: a.reason, amount: a.amount, created_at: a.createdAt })));
    collect('ingredients', (await db.ingredients.toArray()).map(i => ({ device_id: dev, local_id: i.id, name: i.name, unit: i.unit, stock: i.stock, minimum: i.minimum, unit_cost: i.unitCost, active: i.active })));
    collect('recipes', (await db.recipes.toArray()).map(r => ({ device_id: dev, local_id: r.productId, ingredients: r.ingredients })));
    collect('stock_movements', (await db.stockMovements.toArray()).map(m => ({ device_id: dev, local_id: m.id, ingredient_local_id: m.ingredientId, order_local_id: m.orderId ?? null, kind: m.kind, qty: m.qty, unit_cost: m.unitCost, reason: m.reason, actor_local_id: m.actorId, created_at: m.createdAt })));
    collect('expenses',(await db.expenses.toArray()).map(e=>({device_id:dev,local_id:e.id,date:e.date,category:e.category,description:e.description,amount:e.amount,actor_local_id:e.actorId,created_at:e.createdAt,voided_at:e.voidedAt??null,void_reason:e.voidReason??null,shift_local_id:e.shiftId??null})));
    return result;
  });
}
/**
 * Acknowledged state: table -> local_id -> row signature. Storing a short hash per row
 * (instead of the whole row, including base64 menu photos) keeps the ack small.
 */
export type Ack = Record<string, Record<string, string>>;

// cyrb53: fast 53-bit string hash; combined with the length, collisions are negligible here.
function cyrb53(s: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const signature = (row: Record<string, unknown>) => { const s = JSON.stringify(row); return `${s.length}:${cyrb53(s)}`; };

export function acknowledge(current: Snapshot): Ack {
  return Object.fromEntries(Object.entries(current).map(([table, rows]) => [table, Object.fromEntries(rows.map(r => [String(r.local_id), signature(r)]))]));
}
/** Accepts the compact ack, or a full snapshot stored by older app versions. */
function toAck(previous: Snapshot | Ack): Ack {
  return Object.fromEntries(Object.entries(previous).map(([table, rows]) => [table, Array.isArray(rows)
    ? Object.fromEntries(rows.map(r => [String(r.local_id), signature(r)]))
    : rows]));
}
export function difference(current: Snapshot, previous: Snapshot | Ack, dev?: string) {
  const ack = toAck(previous);
  const device = dev ?? Object.values(current).flat()[0]?.device_id
    ?? Object.values(previous).flatMap(rows => Array.isArray(rows) ? rows : [])[0]?.device_id;
  return Object.entries(current).flatMap(([table, rows]) => {
    const old = ack[table] ?? {};
    const ids = new Set(rows.map(r => String(r.local_id)));
    return [
      ...rows.filter(r => old[String(r.local_id)] !== signature(r)).map(row => ({ table, op: 'put', row })),
      // The server only needs the row identity to delete it.
      ...Object.keys(old).filter(id => !ids.has(id)).map(id => ({ table, op: 'delete', row: { device_id: device, local_id: Number(id) } })),
    ];
  });
}
