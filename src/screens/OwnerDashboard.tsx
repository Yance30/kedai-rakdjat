import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSupabase } from '../supabase';
import { loadCloudReport } from '../cloud-reports';
import { buildSalesReport, downloadCsv, jakartaDay } from '../reports';
import { rupiah } from '../money';
import { AreaChart, DonutChart, RankBars } from '../components/Charts';

export default function OwnerDashboard({device}:{device:string}) {
  const [from,setFrom]=useState(jakartaDay(Date.now()-6*86400000));const [to,setTo]=useState(jakartaDay());const [cashier,setCashier]=useState('');
  const [data,setData]=useState<Awaited<ReturnType<typeof loadCloudReport>>|null>(null);
  const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [updated,setUpdated]=useState(0);
  const request=useRef(0);
  const refresh=useCallback(async()=>{
    const id=++request.current;setLoading(true);
    try {const sb=await loadSupabase();if(!sb)throw new Error('Hubungkan Supabase di Pengaturan.');const result=await loadCloudReport(sb,device,from,to);if(id===request.current){setData(result);setError('');setUpdated(Date.now());}}
    catch(e){if(id===request.current){setData(null);setError((e as Error).message);}}
    finally{if(id===request.current)setLoading(false);}
  },[device,from,to]);
  useEffect(()=>{setData(null);void refresh();const timer=setInterval(refresh,15000);return()=>{request.current++;clearInterval(timer);};},[refresh]);
  let report:ReturnType<typeof buildSalesReport>|null=null;
  let rangeError='';
  try { if(data) report=buildSalesReport(data.orders,data.payments,data.shifts,data.staff,[],from,to,cashier?Number(cashier):undefined); } catch(e) { rangeError=(e as Error).message; }
  const days=new Map<string,number>();report?.rows.forEach(r=>days.set(r.day,(days.get(r.day)??0)+r.net));
  const paidIds=new Set(report?.rows.filter(r=>r.status==='paid').map(r=>r.id));
  const menu=new Map<string,number>();data?.items.filter(i=>paidIds.has(i.order_local_id)).forEach(i=>menu.set(i.name,(menu.get(i.name)??0)+i.qty*i.price));
  const ranks=[...menu.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value).slice(0,5);
  return <div className="screen-page"><header className="page-heading"><div><p className="eyebrow">PANTAUAN CLOUD</p><h1>Dashboard Owner</h1><p>{updated?`Diperbarui ${new Date(updated).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta'})} WIB`:'Menunggu data cloud'} · otomatis setiap 15 detik</p></div><button className="secondary-button" disabled={loading} onClick={refresh}>{loading?'Memuat…':'Segarkan'}</button></header>
    <section className="panel mb-5"><div className="flex flex-wrap gap-2 mb-4">{[1,7,30].map(n=><button className="secondary-button" key={n} onClick={()=>{setFrom(jakartaDay(Date.now()-(n-1)*86400000));setTo(jakartaDay());}}>{n===1?'Hari ini':`${n} hari`}</button>)}<button disabled={!report?.rows.length || loading} className="primary-button" onClick={()=>{if(report)downloadCsv([['Order','Waktu WIB','Kasir','Metode','Status','Penerimaan bersih','HPP','Margin bahan'],...report.rows.map(r=>[r.id,new Date(r.time).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'}),r.cashier,r.method,r.status,r.net,r.cost,r.margin])],`cloud-${from}-${to}.csv`);}}>Ekspor CSV</button></div>
      <div className="grid sm:grid-cols-3 gap-3"><label>Dari tanggal<input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} /></label><label>Sampai tanggal<input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)} /></label><label>Kasir<select value={cashier} onChange={e=>setCashier(e.target.value)}><option value="">Semua kasir</option>{data?.staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
    </section>{(error||rangeError)&&<p role="alert" className="notice mb-5">{error||rangeError}</p>}
    {report&&<><div className="metric-grid"><Metric label="Penerimaan bersih" value={rupiah(report.net)} /><Metric label="Transaksi lunas" value={String(report.count)} /><Metric label="Refund penuh" value={rupiah(report.refund)} /><Metric label="Estimasi margin bahan" value={report.margin===null?'HPP belum lengkap':rupiah(report.margin)} /></div>
      <div className="grid lg:grid-cols-2 gap-5 mb-5"><section className="panel"><h2>Tren Penjualan</h2>{days.size?<AreaChart data={[...days.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([day,value])=>({label:day.slice(5),value}))} height={190}/>:<p className="empty-state">Belum ada transaksi dalam rentang ini.</p>}</section><section className="panel"><h2>Komposisi Pembayaran</h2><DonutChart segments={[{label:'Tunai',value:report.cash,color:'#8a000a'},{label:'QRIS',value:report.qris,color:'#c9a227'}]} centerLabel="bersih" /></section></div>
      {!cashier&&data&&<section className="panel mb-5"><h2>Estimasi Laba Operasional</h2><dl className="summary-list"><div><dt>Biaya operasional</dt><dd>{rupiah(data.operatingExpenses)}</dd></div><div><dt>Kerugian / koreksi stok bersih</dt><dd>{rupiah(data.stockLoss)}</dd></div><div><dt>Margin dikurangi biaya dan koreksi stok</dt><dd>{report.margin===null?'HPP belum lengkap':rupiah(report.margin-data.operatingExpenses-data.stockLoss)}</dd></div></dl><p className="text-xs text-gray-500 mt-3">Mengikuti tanggal biaya dan koreksi stok. Belum termasuk biaya yang belum dicatat.</p></section>}
      <div className="grid lg:grid-cols-2 gap-5"><section className="panel"><h2>Menu Terlaris</h2>{ranks.length?<RankBars data={ranks}/>:<p className="empty-state">Belum ada penjualan menu.</p>}</section><section className="panel"><h2>Ringkasan Operasional</h2><dl className="summary-list"><div><dt>Meja terisi sekarang</dt><dd>{data?.tables.filter(t=>t.status==='occupied').length} / {data?.tables.length}</dd></div><div><dt>Rata-rata transaksi aktif</dt><dd>{rupiah(report.count?Math.round(report.net/report.count):0)}</dd></div><div><dt>HPP bahan tercatat</dt><dd>{rupiah(report.cost)}</dd></div></dl><p className="text-xs text-gray-500 mt-4">Margin bahan belum termasuk pajak/service dan biaya operasional. Refund dikelompokkan pada tanggal pembayaran asal. Data mengikuti sinkronisasi tablet.</p></section></div></>}
  </div>;
}
function Metric({label,value}:{label:string;value:string}){return <div className="metric"><p>{label}</p><strong>{value}</strong></div>;}
