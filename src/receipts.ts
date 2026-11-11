import { db } from './db';
import { buildReceipt, printBytes } from './printer';

export async function reprintReceipt(orderId: number, actorId: number, print = printBytes) {
  const data = await db.transaction('r', [db.orders, db.orderItems, db.payments, db.staff, db.shifts], async () => {
    const order = await db.orders.get(orderId);
    const payment = await db.payments.where('orderId').equals(orderId).first();
    if (!order || !payment || order.status === 'open') throw new Error('Struk pembayaran belum tersedia.');
    const shift = await db.shifts.get(order.shiftId);
    const cashier = await db.staff.get(order.cashierId ?? shift?.staffId ?? actorId);
    return { order, payment, items: await db.orderItems.where('orderId').equals(orderId).toArray(), cashier: cashier?.name ?? 'Kasir' };
  });
  await print(buildReceipt(data.order, data.items, data.payment, data.cashier, true));
  await db.audit.add({ action: 'receipt_copy', orderId, shiftId: data.order.shiftId, actorId, amount: 0, reason: 'Cetak ulang struk SALINAN dikirim ke printer', createdAt: Date.now() });
}
