import type { Order } from '../types';
import { buildSalesReport, hourlySales, regularCustomers } from '../reports';
import { rupiah } from '../money';
import { BarChart, RankBars } from './Charts';

type Report = ReturnType<typeof buildSalesReport>;

/** Busy hours, best-selling menus and regular customers for the selected report range. */
export default function SalesInsights({ report, orders, items }: {
  report: Report;
  orders: Order[];
  /** When given, adds a best-selling menu panel (the cloud dashboard has its own). */
  items?: { orderId: number; name: string; qty: number; price: number }[];
}) {
  const hours = hourlySales(report.rows);
  const peak = hours.reduce<(typeof hours)[number] | null>((best, h) => (!best || h.count > best.count ? h : best), null);
  const customers = regularCustomers(orders, report.rows);
  let menus: { label: string; value: number; qty: number }[] = [];
  if (items) {
    const paid = new Set(report.rows.filter(r => r.status === 'paid').map(r => r.id));
    const totals = new Map<string, { value: number; qty: number }>();
    for (const i of items) {
      if (!paid.has(i.orderId)) continue;
      const t = totals.get(i.name) ?? { value: 0, qty: 0 };
      t.value += i.qty * i.price;
      t.qty += i.qty;
      totals.set(i.name, t);
    }
    menus = [...totals].map(([label, t]) => ({ label, ...t })).sort((a, b) => b.qty - a.qty || b.value - a.value).slice(0, 5);
  }
  return (
    <div className="grid lg:grid-cols-2 gap-5 mb-5">
      <section className="panel">
        <h2>Jam Ramai</h2>
        {hours.length ? (
          <>
            <BarChart data={hours.map(h => ({ label: String(h.hour).padStart(2, '0'), value: h.net }))} height={170} />
            {peak && <p className="text-xs text-gray-500 mt-2">Paling ramai pukul {String(peak.hour).padStart(2, '0')}.00–{String(peak.hour + 1).padStart(2, '0')}.00 WIB: {peak.count} transaksi, {rupiah(peak.net)}. Gunakan untuk mengatur jadwal staf dan persiapan bahan.</p>}
          </>
        ) : <p className="empty-state">Belum ada pembayaran pada rentang ini.</p>}
      </section>
      {items && (
        <section className="panel">
          <h2>Menu Terlaris</h2>
          {menus.length ? <RankBars data={menus.map(m => ({ label: `${m.label} · ${m.qty} porsi`, value: m.value }))} /> : <p className="empty-state">Belum ada penjualan menu.</p>}
        </section>
      )}
      <section className="panel">
        <h2>Pelanggan Tetap</h2>
        {customers.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Nama</th><th>Kunjungan</th><th>Total belanja</th><th>Terakhir</th></tr></thead>
              <tbody>{customers.map(c => (
                <tr key={c.name}><td>{c.name}</td><td>{c.visits}×</td><td>{rupiah(c.total)}</td><td>{new Date(c.last).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' })}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="empty-state">Belum ada pesanan dengan nama pelanggan pada rentang ini.</p>}
        <p className="text-xs text-gray-500 mt-3">Dari nama yang diisi kasir (huruf besar/kecil disamakan). Pisah bayar dihitung satu kunjungan. Nama yang sama bisa saja orang berbeda.</p>
      </section>
    </div>
  );
}
