import { db } from './db';
import { deviceId, loadSupabase } from './supabase';

export interface SyncResult {
  ok: boolean;
  msg: string;
}

export async function pushAll(): Promise<SyncResult> {
  const sb = await loadSupabase();
  if (!sb) return { ok: false, msg: 'Cloud belum dikonfigurasi (URL / anon key).' };
  const dev = await deviceId();
  try {
    const [staff, shifts, products, tables, orders, orderItems, payments] = await Promise.all([
      db.staff.toArray(),
      db.shifts.toArray(),
      db.products.toArray(),
      db.meja.toArray(),
      db.orders.toArray(),
      db.orderItems.toArray(),
      db.payments.toArray(),
    ]);

    const upsert = (table: string, rows: Record<string, unknown>[]) =>
      rows.length
        ? sb.from(table).upsert(rows, { onConflict: 'device_id,local_id' }).then((r) => {
            if (r.error) throw new Error(`${table}: ${r.error.message}`);
          })
        : Promise.resolve();

    await upsert('staff', staff.map((s) => ({ device_id: dev, local_id: s.id, name: s.name, role: s.role })));
    await upsert('shifts', shifts.map((s) => ({
      device_id: dev, local_id: s.id, staff_local_id: s.staffId, status: s.status,
      opened_at: s.openedAt, opening_float: s.openingFloat, closed_at: s.closedAt ?? null,
      actual_cash: s.actualCash ?? null, note: s.note ?? null,
    })));
    await upsert('products', products.map((p) => ({
      device_id: dev, local_id: p.id, name: p.name, category: p.category, price: p.price, active: p.active,
    })));
    await upsert('dining_tables', tables.map((t) => ({ device_id: dev, local_id: t.id, name: t.name, status: t.status })));
    // kds_status intentionally omitted so kitchen updates in cloud are not overwritten.
    await upsert('orders', orders.map((o) => ({
      device_id: dev, local_id: o.id, shift_local_id: o.shiftId, status: o.status, created_at: o.createdAt,
      subtotal: o.subtotal, service: o.service, tax: o.tax, total: o.total, order_type: o.orderType,
      table_local_id: o.tableId ?? null,
    })));
    await upsert('order_items', orderItems.map((i) => ({
      device_id: dev, local_id: i.id, order_local_id: i.orderId, product_local_id: i.productId,
      name: i.name, qty: i.qty, price: i.price,
    })));
    await upsert('payments', payments.map((p) => ({
      device_id: dev, local_id: p.id, order_local_id: p.orderId, shift_local_id: p.shiftId,
      method: p.method, amount: p.amount, tendered: p.tendered, change: p.change, created_at: p.createdAt,
    })));

    await db.settings.put({ key: 'last_sync', value: String(Date.now()) });
    return { ok: true, msg: 'Sync ke cloud berhasil.' };
  } catch (e) {
    return { ok: false, msg: (e as Error).message };
  }
}