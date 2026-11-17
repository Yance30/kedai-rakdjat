import { describe, expect, it } from 'vitest';
import { buildSalesReport, hourlySales, jakartaHour, regularCustomers } from '../src/reports';
import { lowStockSummary } from '../src/inventory';
import type { Ingredient, Order, Payment } from '../src/types';

const wib = (iso: string) => Date.parse(`${iso}+07:00`);
const base = { shiftId: 1, createdAt: wib('2026-11-16T08:00:00'), subtotal: 20000, service: 0, tax: 0, total: 20000, orderType: 'takeaway' as const, cashierId: 1 };
function sale(id: number, time: string, extra: Partial<Order> = {}): { order: Order; payment: Payment } {
  const at = wib(time);
  return {
    order: { ...base, id, status: 'paid', paidAt: at, ...extra },
    payment: { id, orderId: id, shiftId: extra.shiftId ?? 1, method: 'cash', amount: extra.total ?? 20000, tendered: 20000, change: 0, createdAt: at },
  };
}
function report(sales: ReturnType<typeof sale>[]) {
  return buildSalesReport(sales.map(s => s.order), sales.map(s => s.payment), [{ id: 1, staffId: 1, status: 'open', openedAt: 0, openingFloat: 0 }], [{ id: 1, name: 'Ani', role: 'kasir', pinHash: '' }], [], '2026-11-16', '2026-11-17');
}

describe('jam ramai', () => {
  it('memakai jam WIB dan memotong jam tanpa transaksi di awal dan akhir', () => {
    expect(jakartaHour(wib('2026-11-16T23:30:00'))).toBe(23);
    const r = report([sale(1, '2026-11-16T09:10:00'), sale(2, '2026-11-16T09:50:00'), sale(3, '2026-11-16T12:05:00'), sale(4, '2026-11-16T12:30:00', { status: 'void' })]);
    const hours = hourlySales(r.rows);
    expect(hours.map(h => h.hour)).toEqual([9, 10, 11, 12]);
    expect(hours[0]).toEqual({ hour: 9, net: 40000, count: 2 });
    expect(hours[3]).toEqual({ hour: 12, net: 20000, count: 1 });
  });
  it('kosong bila tidak ada pembayaran lunas', () => {
    expect(hourlySales(report([]).rows)).toEqual([]);
  });
});

describe('pelanggan tetap', () => {
  it('menyamakan huruf/spasi nama dan menghitung pisah bayar sebagai satu kunjungan', () => {
    const sales = [
      sale(1, '2026-11-16T09:00:00', { customerName: 'Budi', queueNo: 3 }),
      sale(2, '2026-11-16T09:01:00', { customerName: 'budi ', queueNo: 3, total: 5000 }),
      sale(3, '2026-11-17T10:00:00', { customerName: '  BUDI', queueNo: 1, shiftId: 2 }),
      sale(4, '2026-11-17T11:00:00', { customerName: 'Sari', queueNo: 2, shiftId: 2 }),
      sale(5, '2026-11-17T11:30:00', { customerName: 'Sari', queueNo: 4, shiftId: 2, status: 'void' }),
      sale(6, '2026-11-17T12:00:00'),
    ];
    const list = regularCustomers(sales.map(s => s.order), report(sales).rows);
    expect(list).toEqual([
      { name: 'BUDI', visits: 2, total: 45000, last: wib('2026-11-17T10:00:00') },
      { name: 'Sari', visits: 1, total: 20000, last: wib('2026-11-17T11:00:00') },
    ]);
  });
});

describe('stok menipis', () => {
  const ing = (id: number, stock: number, minimum: number, active: 0 | 1 = 1): Ingredient => ({ id, name: `B${id}`, unit: 'g', stock, minimum, unitCost: 1, active });
  it('mendaftar bahan di bawah minimum dan menu yang memakainya', () => {
    const { low, affected } = lowStockSummary(
      [ing(1, 10, 50), ing(2, 500, 100), ing(3, 0, 10, 0)],
      [{ productId: 1, ingredients: [{ ingredientId: 1, qty: 18 }] }, { productId: 2, ingredients: [{ ingredientId: 1, qty: 5 }, { ingredientId: 2, qty: 10 }] }, { productId: 3, ingredients: [{ ingredientId: 2, qty: 10 }] }, { productId: 4, ingredients: [{ ingredientId: 1, qty: 1 }] }],
      [{ id: 1, name: 'Kopi Susu', active: 1 }, { id: 2, name: 'Americano', active: 1 }, { id: 3, name: 'Teh', active: 1 }, { id: 4, name: 'Lama', active: 0 }],
    );
    expect(low.map(i => i.id)).toEqual([1]);
    expect(affected).toEqual([{ name: 'Kopi Susu', short: true }, { name: 'Americano', short: false }]);
  });
});
