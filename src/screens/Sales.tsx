import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { buildSalesReport, downloadCsv, jakartaDay, rangeBounds } from '../reports';
import { rupiah } from '../money';
import { BarChart } from '../components/Charts';

export default function Sales() {
  const [from, setFrom] = useState(jakartaDay());
  const [to, setTo] = useState(jakartaDay());
  const [cashier, setCashier] = useState('');
  const data = useLiveQuery(() => db.transaction('r', [db.orders, db.payments, db.shifts, db.staff, db.audit,db.expenses,db.stockMovements], async () => ({ orders: await db.orders.toArray(), payments: await db.payments.toArray(), shifts: await db.shifts.toArray(), staff: await db.staff.toArray(), audit: await db.audit.toArray(), expenses: await db.expenses.toArray(), movements:await db.stockMovements.toArray() })), []);
  if (!data) return <div className="p-6">Memuat laporan…</div>;
  let report: ReturnType<typeof buildSalesReport> | undefined, error = '';
  try { report = buildSalesReport(data.orders, data.payments, data.shifts, data.staff, data.audit, from, to, cashier ? Number(cashier) : undefined); } catch (e) { error = (e as Error).message; }
  const expenses=data.expenses.filter(e=>!e.voidedAt && e.date>=from && e.date<=to).reduce((s,e)=>s+e.amount,0);
  let stockLoss=0;try{const bounds=rangeBounds(from,to);stockLoss=Math.round(data.movements.filter(m=>['waste','stocktake','adjustment'].includes(m.kind)&&m.createdAt>=bounds.start&&m.createdAt<bounds.end).reduce((s,m)=>s-m.qty*m.unitCost,0));}catch{}
  const days = new Map<string, number>();
  report?.rows.forEach(r => days.set(r.day, (days.get(r.day) ?? 0) + r.net));
  const trend = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label: label.slice(5), value }));
  function preset(days: number) { setFrom(jakartaDay(Date.now() - (days - 1) * 86400000)); setTo(jakartaDay()); }
  return <div className="screen-page">
    <header className="page-heading"><div><p className="eyebrow">KINERJA USAHA</p><h1>Laporan Penjualan</h1><p>Pembayaran berdasarkan waktu WIB, dengan rincian kasir dan harga pokok.</p></div>
      <button disabled={!report?.rows.length} className="primary-button" onClick={() => {
        if (!report) return;
        downloadCsv([['Order', 'Waktu WIB', 'Kasir', 'Metode', 'Status', 'Pembayaran awal', 'Refund', 'Penerimaan bersih', 'Penjualan tanpa pajak/service', 'HPP bahan', 'Margin bahan', 'HPP lengkap'], ...report.rows.map(r => [r.id, new Date(r.time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), r.cashier, r.method, r.status, r.gross, r.refund, r.net, r.subtotal, r.cost, r.margin, r.costComplete ? 'Ya' : 'Belum'])], `penjualan-${from}-${to}.csv`);
      }}>Ekspor CSV</button>
    </header>
    <section className="panel mb-5"><div className="flex flex-wrap gap-2 mb-4">{[[1, 'Hari ini'], [7, '7 hari'], [30, '30 hari']].map(([n, label]) => <button key={n} className="secondary-button" onClick={() => preset(Number(n))}>{label}</button>)}</div>
      <div className="grid sm:grid-cols-3 gap-3"><label>Dari tanggal<input aria-label="Dari tanggal" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Sampai tanggal<input aria-label="Sampai tanggal" type="date" value={to} onChange={e => setTo(e.target.value)} /></label><label>Kasir<select aria-label="Filter kasir" value={cashier} onChange={e => setCashier(e.target.value)}><option value="">Semua kasir</option>{data.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
    </section>
    {error && <p role="alert" className="notice">{error}</p>}
    {report && <>
      <div className="metric-grid"><Metric title="Penerimaan bersih" value={rupiah(report.net)} /><Metric title="Transaksi aktif" value={String(report.count)} /><Metric title="Refund penuh" value={rupiah(report.refund)} /><Metric title="Estimasi margin bahan" value={report.margin === null ? 'HPP belum lengkap' : rupiah(report.margin)} /></div>
      <p className="text-xs text-gray-500 mb-5">Margin bahan = penjualan tanpa pajak/service − HPP bahan. Belum termasuk gaji, sewa, listrik, dan biaya lainnya. Refund ditampilkan pada tanggal pembayaran asal.</p>
      <div className="grid lg:grid-cols-2 gap-5 mb-5"><section className="panel"><h2>Penjualan per Hari</h2>{trend.length ? <BarChart data={trend} height={180} /> : <p className="empty-state">Belum ada pembayaran pada rentang ini.</p>}</section><section className="panel"><h2>Ringkasan Pembayaran</h2><dl className="summary-list"><div><dt>Tunai bersih</dt><dd>{rupiah(report.cash)}</dd></div><div><dt>QRIS bersih</dt><dd>{rupiah(report.qris)}</dd></div><div><dt>HPP bahan tercatat</dt><dd>{rupiah(report.cost)}</dd></div><div><dt>Kelengkapan HPP</dt><dd>{report.costComplete ? 'Lengkap' : 'Sebagian resep belum tersedia'}</dd></div></dl></section></div>
      {!cashier&&<section className="panel mb-5"><h2>Estimasi Laba Operasional</h2><dl className="summary-list"><div><dt>Biaya operasional</dt><dd>{rupiah(expenses)}</dd></div><div><dt>Kerugian / koreksi stok bersih</dt><dd>{rupiah(stockLoss)}</dd></div><div><dt>Margin bahan dikurangi biaya dan koreksi stok</dt><dd>{report.margin===null?'HPP belum lengkap':rupiah(report.margin-expenses-stockLoss)}</dd></div></dl><p className="text-xs text-gray-500 mt-3">Berdasarkan biaya yang dicatat dan tanggal koreksi stok. Belum termasuk biaya yang belum dicatat. Pembelian bahan tidak dikurangi lagi karena sudah masuk HPP.</p></section>}
      <section className="panel"><h2>Rincian Transaksi</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Pesanan</th><th>Waktu WIB</th><th>Kasir</th><th>Metode</th><th>Status</th><th>Penerimaan</th><th>HPP</th></tr></thead><tbody>{report.rows.map(r => <tr key={r.id}><td>#{r.id}</td><td>{new Date(r.time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td><td>{r.cashier}</td><td>{r.method === 'cash' ? 'Tunai' : 'QRIS'}</td><td>{r.status === 'paid' ? 'Lunas' : 'Refund'}</td><td>{rupiah(r.net)}</td><td>{r.costComplete ? rupiah(r.cost ?? 0) : 'Belum lengkap'}</td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}
function Metric({ title, value }: { title: string; value: string }) { return <div className="metric"><p>{title}</p><strong>{value}</strong></div>; }
