import type { AuditEvent, Order, Payment, Shift, Staff } from './types';

export function jakartaDay(time = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function rangeBounds(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Pilih tanggal mulai dan selesai.');
  const start = Date.parse(`${from}T00:00:00+07:00`), end = Date.parse(`${to}T00:00:00+07:00`) + 86400000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || jakartaDay(start) !== from || jakartaDay(end - 1) !== to) throw new Error('Rentang tanggal tidak valid.');
  return { start, end };
}
export function buildSalesReport(orders: Order[], payments: Payment[], shifts: Shift[], staff: Staff[], audit: AuditEvent[], from: string, to: string, cashierId?: number) {
  const { start, end } = rangeBounds(from, to);
  const byOrder = new Map(orders.map(o => [o.id, o]));
  const byShift = new Map(shifts.map(s => [s.id, s]));
  const actors = new Map(audit.filter(a => a.action === 'payment').map(a => [a.orderId, a.actorId]));
  const rows = payments.flatMap(p => {
    const o = byOrder.get(p.orderId);
    if (!o || p.createdAt < start || p.createdAt >= end) return [];
    const actorId = o.cashierId ?? actors.get(o.id) ?? byShift.get(o.shiftId)?.staffId;
    if (cashierId && actorId !== cashierId) return [];
    const net = o.status === 'paid' ? o.total : 0;
    const subtotal = o.status === 'paid' ? o.subtotal - (o.discount ?? 0) : 0;
    const cost = o.stockReturned ? 0 : o.costTotal;
    return [{ id: o.id!, time: p.createdAt, day: jakartaDay(p.createdAt), cashier: staff.find(s => s.id === actorId)?.name ?? 'Tidak diketahui', actorId, method: p.method, status: o.status, gross: p.amount, refund: o.status === 'void' ? p.amount : 0, net, subtotal, cost, costComplete: o.costComplete === true, margin: o.costComplete ? subtotal - (cost ?? 0) : null }];
  }).sort((a, b) => b.time - a.time);
  const net = rows.reduce((s, r) => s + r.net, 0);
  const costComplete = rows.every(r => r.costComplete);
  const cost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  return {
    rows, net, cost, costComplete,
    count: rows.filter(r => r.status === 'paid').length,
    refund: rows.reduce((s, r) => s + r.refund, 0),
    cash: rows.filter(r => r.method === 'cash').reduce((s, r) => s + r.net, 0),
    qris: rows.filter(r => r.method === 'qris').reduce((s, r) => s + r.net, 0),
    margin: costComplete ? rows.reduce((s, r) => s + r.subtotal, 0) - cost : null,
  };
}
export function csvText(rows: (string | number | null | undefined)[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let s = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return `"${s.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}
export function downloadCsv(rows: (string | number | null | undefined)[][], filename: string) {
  const url = URL.createObjectURL(new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
