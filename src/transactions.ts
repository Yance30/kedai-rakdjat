import { authenticatePin } from './auth';
import { db } from './db';
import type { Order, OrderItem, Payment } from './types';
import { consumeRecipe, returnOrderStock } from './inventory';
import { drawerExpenses } from './operations';

export const TAX_RATE = 10;
/** Discount comes off the subtotal first; service is charged on the discounted amount, then tax on both. */
export function priceOrder(subtotal: number, discount: number, serviceRate: number) {
  const service = Math.round((subtotal - discount) * serviceRate / 100);
  const tax = Math.round((subtotal - discount + service) * TAX_RATE / 100);
  return { service, tax, total: subtotal - discount + service + tax };
}

export function validateSale(order: Order, items: Omit<OrderItem, 'id' | 'orderId'>[]) {
  const money = [order.subtotal, order.service, order.tax, order.total, ...items.map(i => i.price)];
  if (!items.length || money.some(n => !Number.isSafeInteger(n) || n < 0) ||
      items.some(i => !Number.isSafeInteger(i.qty) || i.qty < 1) || order.total <= 0 ||
      items.reduce((s, i) => s + i.qty * i.price, 0) !== order.subtotal ||
      (!Number.isSafeInteger(order.discount ?? 0) || (order.discount ?? 0) < 0 || (order.discount ?? 0) >= order.subtotal) ||
      order.subtotal - (order.discount ?? 0) + order.service + order.tax !== order.total) throw new Error('Nilai pesanan tidak valid.');
}

export async function commitSale(order: Order, items: Omit<OrderItem, 'id' | 'orderId'>[], payment: Payment, actorId: number, loadedOrderId: number | null, draft?: { key: string; revision: number }, discountPin?: string) {
  validateSale(order, items);
  if (!payment.requestId || !['cash', 'qris'].includes(payment.method) || payment.amount !== order.total ||
    !Number.isSafeInteger(payment.tendered) || payment.tendered < order.total ||
    payment.change !== payment.tendered - order.total || (payment.method === 'qris' && payment.change !== 0)) throw new Error('Pembayaran tidak valid.');
  const approver = (order.discount ?? 0) > 0 ? await authenticatePin(discountPin ?? '', true) : undefined;
  if (approver && (order.discountReason?.trim().length ?? 0) < 5) throw new Error('Alasan diskon minimal 5 karakter.');
  order = { ...order, discountApproverId: approver?.id };
  return db.transaction('rw', [db.products, db.staff, db.orders, db.orderItems, db.payments, db.meja, db.shifts, db.audit, db.drafts, db.ingredients, db.recipes, db.stockMovements], async () => {
    const prior = await db.payments.where('requestId').equals(payment.requestId!).first();
    if (prior) {
      if (prior.amount !== payment.amount || prior.method !== payment.method || prior.tendered !== payment.tendered || prior.shiftId !== order.shiftId || (loadedOrderId !== null && prior.orderId !== loadedOrderId)) throw new Error('ID pembayaran telah dipakai dengan data berbeda.');
      return prior.orderId;
    }
    const shift = await db.shifts.get(order.shiftId);
    if (!shift || shift.status !== 'open') throw new Error('Shift sudah ditutup. Login kembali.');
    // An unedited cart loaded from a saved table order has revision 0 and no stored draft.
    if (draft && ((await db.drafts.get(draft.key))?.revision ?? 0) !== draft.revision) throw new Error('Keranjang berubah di tab lain. Muat ulang dahulu.');
    let id: number;
    if (loadedOrderId) {
      const existing = await db.orders.get(loadedOrderId);
      if (!existing || existing.status !== 'open' || existing.shiftId !== order.shiftId ||
          await db.payments.where('orderId').equals(loadedOrderId).count()) throw new Error('Pesanan sudah dibayar atau berubah. Muat ulang meja.');
      id = loadedOrderId;
      await db.orders.put({ ...order, id, createdAt: existing.createdAt, status: 'paid' });
      await db.orderItems.where('orderId').equals(id).delete();
    } else {
      if (order.tableId && await db.orders.where('tableId').equals(order.tableId).and(o => o.status === 'open').count()) throw new Error('Meja memiliki pesanan terbuka. Muat ulang meja.');
      id = await db.orders.add({ ...order, status: 'paid' });
    }
    for (const item of items) { const p=await db.products.get(item.productId); if (!p || !p.active || p.soldOut) throw new Error(`Menu ${item.name} tidak tersedia. Hapus dari keranjang dahulu.`); }
    if (approver && (await db.staff.get(approver.id!))?.role !== 'owner') throw new Error('Persetujuan owner tidak lagi valid.');
    const cost = await consumeRecipe(id, items, actorId);
    await db.orders.update(id, { cashierId: actorId, paidAt: payment.createdAt, costTotal: cost.total, costComplete: cost.complete });
    await db.orderItems.bulkAdd(cost.lines.map(i => ({ ...i, orderId: id })));
    await db.payments.add({ ...payment, orderId: id, shiftId: order.shiftId });
    if (order.tableId) await db.meja.update(order.tableId, { status: 'cleaning' });
    await db.audit.add({ action: 'payment', orderId: id, shiftId: order.shiftId, actorId, amount: order.total, reason: payment.method, createdAt: Date.now() });
    if (approver) await db.audit.add({action:'discount',orderId:id,shiftId:order.shiftId,actorId,approverId:approver.id,reason:order.discountReason!.trim(),amount:order.discount!,createdAt:Date.now()});
    if (draft) await db.drafts.delete(draft.key);
    return id;
  });
}

export interface SplitPart { productId: number; qty: number }
/**
 * Pays part of an open table order as its own order (one payment per order keeps reports, cloud
 * constraints and backups unchanged). Items and prices come from the saved order, not the client.
 * The parent keeps the remaining items, its kitchen ticket and the table; paying everything that is
 * left goes through commitSale on the parent instead.
 */
export async function commitSplit(parentId: number, parts: SplitPart[], payment: Payment, actorId: number, serviceRate: number, discount?: { amount: number; reason: string; pin: string }) {
  if (!parts.length || parts.some(p => !Number.isSafeInteger(p.qty) || p.qty < 1) || new Set(parts.map(p => p.productId)).size !== parts.length) throw new Error('Pilih item yang dibayar terpisah.');
  if (!payment.requestId || !['cash', 'qris'].includes(payment.method) || !Number.isSafeInteger(payment.tendered) || payment.change !== payment.tendered - payment.amount || payment.change < 0 || (payment.method === 'qris' && payment.change !== 0)) throw new Error('Pembayaran tidak valid.');
  if (![0, 5].includes(serviceRate)) throw new Error('Service charge tidak valid.');
  const discountAmount = discount?.amount ?? 0;
  const approver = discountAmount > 0 ? await authenticatePin(discount!.pin, true) : undefined;
  if (approver && discount!.reason.trim().length < 5) throw new Error('Alasan diskon minimal 5 karakter.');
  return db.transaction('rw', [db.staff, db.orders, db.orderItems, db.payments, db.shifts, db.audit, db.drafts, db.ingredients, db.recipes, db.stockMovements], async () => {
    const prior = await db.payments.where('requestId').equals(payment.requestId!).first();
    if (prior) {
      const done = await db.orders.get(prior.orderId);
      if (done?.splitFrom !== parentId || prior.amount !== payment.amount || prior.method !== payment.method || prior.tendered !== payment.tendered) throw new Error('ID pembayaran telah dipakai dengan data berbeda.');
      return prior.orderId;
    }
    const parent = await db.orders.get(parentId);
    if (!parent || parent.status !== 'open' || !parent.tableId || await db.payments.where('orderId').equals(parentId).count()) throw new Error('Pesanan meja sudah dibayar atau berubah. Muat ulang meja.');
    if ((await db.shifts.get(parent.shiftId))?.status !== 'open') throw new Error('Shift sudah ditutup. Login kembali.');
    const saved = await db.orderItems.where('orderId').equals(parentId).toArray();
    const taken: Omit<OrderItem, 'id' | 'orderId'>[] = [];
    const left: Omit<OrderItem, 'id' | 'orderId'>[] = [];
    const wanted = new Map(parts.map(p => [p.productId, p.qty]));
    for (const item of saved) {
      const qty = Math.min(wanted.get(item.productId) ?? 0, item.qty);
      if (qty) wanted.set(item.productId, wanted.get(item.productId)! - qty);
      const { id: _id, orderId: _order, costTotal: _cost, ...line } = item;
      if (qty) taken.push({ ...line, qty });
      if (item.qty > qty) left.push({ ...line, qty: item.qty - qty });
    }
    if ([...wanted.values()].some(qty => qty > 0)) throw new Error('Jumlah item terpisah melebihi pesanan meja. Muat ulang meja.');
    if (!left.length) throw new Error('Semua item dipilih. Bayar seluruh sisa pesanan dengan pembayaran biasa.');
    const subtotal = taken.reduce((s, i) => s + i.qty * i.price, 0);
    const order: Order = { shiftId: parent.shiftId, status: 'paid', createdAt: Date.now(), subtotal, discount: discountAmount, discountReason: approver ? discount!.reason.trim() : undefined, discountApproverId: approver?.id, ...priceOrder(subtotal, discountAmount, serviceRate), orderType: 'dine_in', tableId: parent.tableId, splitFrom: parentId };
    validateSale(order, taken);
    if (payment.amount !== order.total || payment.tendered < order.total) throw new Error('Total bill terpisah berubah. Periksa ulang pembayaran.');
    if (approver && (await db.staff.get(approver.id!))?.role !== 'owner') throw new Error('Persetujuan owner tidak lagi valid.');
    const restSubtotal = left.reduce((s, i) => s + i.qty * i.price, 0);
    await db.orders.update(parentId, { subtotal: restSubtotal, ...priceOrder(restSubtotal, 0, serviceRate) });
    await db.orderItems.where('orderId').equals(parentId).delete();
    await db.orderItems.bulkAdd(left.map(i => ({ ...i, orderId: parentId })));
    const id = await db.orders.add(order);
    const cost = await consumeRecipe(id, taken, actorId);
    await db.orders.update(id, { cashierId: actorId, paidAt: payment.createdAt, costTotal: cost.total, costComplete: cost.complete });
    await db.orderItems.bulkAdd(cost.lines.map(i => ({ ...i, orderId: id })));
    await db.payments.add({ ...payment, orderId: id, shiftId: parent.shiftId });
    await db.audit.add({ action: 'payment', orderId: id, shiftId: parent.shiftId, actorId, amount: order.total, reason: `${payment.method}; pisah bill dari #${parentId}`, createdAt: Date.now() });
    if (approver) await db.audit.add({ action: 'discount', orderId: id, shiftId: parent.shiftId, actorId, approverId: approver.id, reason: order.discountReason!, amount: discountAmount, createdAt: Date.now() });
    // The table cart reloads from the shrunken order.
    await db.drafts.where('tableId').equals(parent.tableId).delete();
    return id;
  });
}

export async function reverseOrder(orderId: number, actorId: number, approverId: number, reason: string, restock = false) {
  if (reason.trim().length < 5) throw new Error('Tuliskan alasan minimal 5 karakter.');
  return db.transaction('rw', [db.orders, db.shifts, db.staff, db.audit, db.meja, db.payments, db.ingredients, db.stockMovements], async () => {
    const owner = await db.staff.get(approverId);
    if (owner?.role !== 'owner' || owner.mustChangePin) throw new Error('Persetujuan owner diperlukan.');
    const order = await db.orders.get(orderId);
    if (!order || order.status === 'void') throw new Error('Pesanan sudah dibatalkan atau tidak ditemukan.');
    if ((await db.shifts.get(order.shiftId))?.status !== 'open') throw new Error('Shift sudah ditutup; pembatalan ditolak.');
    const refunded = order.status === 'paid';
    await db.audit.add({ action: refunded ? 'refund' : 'void', orderId, shiftId: order.shiftId, actorId, approverId, reason: reason.trim(), amount: refunded ? order.total : 0, createdAt: Date.now() });
    if (restock && refunded) await returnOrderStock(orderId, actorId);
    await db.orders.update(orderId, { status: 'void', stockReturned: restock && refunded });
    // A refunded split part must not free a table whose remaining order is still being served.
    if (order.tableId && !await db.orders.where('tableId').equals(order.tableId).and(o => o.status === 'open').count()) await db.meja.update(order.tableId, { status: 'cleaning' });
  });
}

export async function closeShift(shiftId: number, actorId: number, physical: number, approverId?: number) {
  if (!Number.isSafeInteger(physical) || physical < 0) throw new Error('Hitungan kas tidak valid.');
  return db.transaction('rw', [db.shifts, db.orders, db.payments, db.staff, db.audit, db.drafts, db.expenses], async () => {
    const shift = await db.shifts.get(shiftId);
    if (!shift || shift.status !== 'open') throw new Error('Shift sudah ditutup.');
    const orders = await db.orders.where('shiftId').equals(shiftId).toArray();
    if (orders.some(o => o.status === 'open')) throw new Error('Selesaikan semua pesanan terbuka dahulu.');
    if (await db.drafts.where('shiftId').equals(shiftId).and(d => d.lines.length > 0).count()) throw new Error('Masih ada keranjang tersimpan. Bayar atau kosongkan dahulu.');
    const paid = new Set(orders.filter(o => o.status === 'paid').map(o => o.id));
    const payments = await db.payments.where('shiftId').equals(shiftId).toArray();
    const cashOut = await drawerExpenses(shiftId);
    const expected = shift.openingFloat + payments.filter(p => p.method === 'cash' && paid.has(p.orderId)).reduce((s, p) => s + p.amount, 0) - cashOut;
    const diff = physical - expected;
    if (diff !== 0 && (!approverId || (await db.staff.get(approverId))?.role !== 'owner')) throw new Error('Selisih kas membutuhkan persetujuan owner.');
    await db.shifts.update(shiftId, { status: 'closed', closedAt: Date.now(), actualCash: physical, note: `Selisih Rp ${diff}` });
    await db.audit.add({ action: 'shift_close', shiftId, actorId, approverId, amount: diff, reason: `Kas diharapkan ${expected}; fisik ${physical}${cashOut ? `; pengeluaran laci ${cashOut}` : ''}`, createdAt: Date.now() });
  });
}
