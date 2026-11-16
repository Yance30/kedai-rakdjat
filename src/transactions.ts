import { authenticatePin } from './auth';
import { db } from './db';
import type { CartDraft, Order, OrderItem, Payment } from './types';
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

export const CUSTOMER_NAME_MAX = 30;
/** Trims and collapses whitespace; an empty name is stored as undefined. */
export function cleanCustomerName(name?: string) {
  const clean = (name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length > CUSTOMER_NAME_MAX) throw new Error(`Nama pelanggan maksimal ${CUSTOMER_NAME_MAX} karakter.`);
  return clean || undefined;
}

/**
 * Pays a cart. With `remaining`, only part of the cart is paid (split payment): the unpaid lines are
 * written back as the cart draft in the same transaction, carrying the queue number of this part.
 */
export async function commitSale(order: Order, items: Omit<OrderItem, 'id' | 'orderId'>[], payment: Payment, actorId: number, loadedOrderId: number | null, draft?: { key: string; revision: number }, discountPin?: string, remaining?: CartDraft) {
  validateSale(order, items);
  order = { ...order, customerName: cleanCustomerName(order.customerName) };
  if (order.queueNo !== undefined && (!Number.isSafeInteger(order.queueNo) || order.queueNo < 1)) throw new Error('Nomor antrean tidak valid.');
  if (remaining && (loadedOrderId || !remaining.lines.length || remaining.key !== draft?.key)) throw new Error('Pembayaran sebagian tidak valid.');
  if (!payment.requestId || !['cash', 'qris'].includes(payment.method) || payment.amount !== order.total ||
    !Number.isSafeInteger(payment.tendered) || payment.tendered < order.total ||
    payment.change !== payment.tendered - order.total || (payment.method === 'qris' && payment.change !== 0)) throw new Error('Pembayaran tidak valid.');
  const approver = (order.discount ?? 0) > 0 ? await authenticatePin(discountPin ?? '', true) : undefined;
  if (approver && (order.discountReason?.trim().length ?? 0) < 5) throw new Error('Alasan diskon minimal 5 karakter.');
  order = { ...order, discountApproverId: approver?.id };
  return db.transaction('rw', [db.products, db.staff, db.orders, db.orderItems, db.payments, db.shifts, db.audit, db.drafts, db.ingredients, db.recipes, db.stockMovements], async () => {
    const prior = await db.payments.where('requestId').equals(payment.requestId!).first();
    if (prior) {
      if (prior.amount !== payment.amount || prior.method !== payment.method || prior.tendered !== payment.tendered || prior.shiftId !== order.shiftId || (loadedOrderId !== null && prior.orderId !== loadedOrderId)) throw new Error('ID pembayaran telah dipakai dengan data berbeda.');
      return prior.orderId;
    }
    const shift = await db.shifts.get(order.shiftId);
    if (!shift || shift.status !== 'open') throw new Error('Shift sudah ditutup. Login kembali.');
    // An unedited cart loaded from a saved table order has revision 0 and no stored draft.
    if (draft && ((await db.drafts.get(draft.key))?.revision ?? 0) !== draft.revision) throw new Error('Keranjang berubah di tab lain. Muat ulang dahulu.');
    if (order.queueNo === undefined) {
      const shiftOrders = await db.orders.where('shiftId').equals(order.shiftId).toArray();
      const existing = loadedOrderId ? shiftOrders.find(o => o.id === loadedOrderId)?.queueNo : undefined;
      order.queueNo = existing ?? shiftOrders.reduce((max, o) => Math.max(max, o.queueNo ?? 0), 0) + 1;
    }
    let id: number;
    if (loadedOrderId) {
      const existing = await db.orders.get(loadedOrderId);
      if (!existing || existing.status !== 'open' || existing.shiftId !== order.shiftId ||
          await db.payments.where('orderId').equals(loadedOrderId).count()) throw new Error('Pesanan sudah dibayar atau berubah. Muat ulang.');
      id = loadedOrderId;
      await db.orders.put({ ...order, id, createdAt: existing.createdAt, status: 'paid' });
      await db.orderItems.where('orderId').equals(id).delete();
    } else {
      id = await db.orders.add({ ...order, status: 'paid' });
    }
    for (const item of items) { const p=await db.products.get(item.productId); if (!p || !p.active || p.soldOut) throw new Error(`Menu ${item.name} tidak tersedia. Hapus dari keranjang dahulu.`); }
    if (approver && (await db.staff.get(approver.id!))?.role !== 'owner') throw new Error('Persetujuan owner tidak lagi valid.');
    const cost = await consumeRecipe(id, items, actorId);
    await db.orders.update(id, { cashierId: actorId, paidAt: payment.createdAt, costTotal: cost.total, costComplete: cost.complete });
    await db.orderItems.bulkAdd(cost.lines.map(i => ({ ...i, orderId: id })));
    await db.payments.add({ ...payment, orderId: id, shiftId: order.shiftId });
    await db.audit.add({ action: 'payment', orderId: id, shiftId: order.shiftId, actorId, amount: order.total, reason: payment.method, createdAt: Date.now() });
    if (approver) await db.audit.add({action:'discount',orderId:id,shiftId:order.shiftId,actorId,approverId:approver.id,reason:order.discountReason!.trim(),amount:order.discount!,createdAt:Date.now()});
    if (remaining) await db.drafts.put({ ...remaining, queueNo: order.queueNo, updatedAt: Date.now() });
    else if (draft) await db.drafts.delete(draft.key);
    return id;
  });
}

export async function reverseOrder(orderId: number, actorId: number, approverId: number, reason: string, restock = false) {
  if (reason.trim().length < 5) throw new Error('Tuliskan alasan minimal 5 karakter.');
  return db.transaction('rw', [db.orders, db.shifts, db.staff, db.audit, db.payments, db.ingredients, db.stockMovements], async () => {
    const owner = await db.staff.get(approverId);
    if (owner?.role !== 'owner' || owner.mustChangePin) throw new Error('Persetujuan owner diperlukan.');
    const order = await db.orders.get(orderId);
    if (!order || order.status === 'void') throw new Error('Pesanan sudah dibatalkan atau tidak ditemukan.');
    if ((await db.shifts.get(order.shiftId))?.status !== 'open') throw new Error('Shift sudah ditutup; pembatalan ditolak.');
    const refunded = order.status === 'paid';
    await db.audit.add({ action: refunded ? 'refund' : 'void', orderId, shiftId: order.shiftId, actorId, approverId, reason: reason.trim(), amount: refunded ? order.total : 0, createdAt: Date.now() });
    if (restock && refunded) await returnOrderStock(orderId, actorId);
    await db.orders.update(orderId, { status: 'void', stockReturned: restock && refunded });
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
