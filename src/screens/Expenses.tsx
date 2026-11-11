import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addExpense,voidExpense } from '../operations';
import { jakartaDay,downloadCsv } from '../reports';
import { rupiah } from '../money';
import type { Staff } from '../types';
export default function Expenses({actor}:{actor:Staff}) {
  const rows=useLiveQuery(()=>db.expenses.orderBy('date').reverse().toArray(),[])??[];
  const [date,setDate]=useState(jakartaDay()),[category,setCategory]=useState('Listrik'),[description,setDescription]=useState(''),[amount,setAmount]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  return <div className="screen-page"><header className="page-heading"><div><p className="eyebrow">BIAYA USAHA</p><h1>Pengeluaran Operasional</h1><p>Catatan biaya untuk laporan laba. Tidak mengambil uang dari laci kas shift secara otomatis.</p></div><button className="secondary-button" onClick={()=>downloadCsv([['Tanggal','Kategori','Keterangan','Nominal','Status','Alasan batal'],...rows.map(r=>[r.date,r.category,r.description,r.amount,r.voidedAt?'Batal':'Aktif',r.voidReason])],'pengeluaran.csv')}>Ekspor pengeluaran</button></header>
  <p className="notice mb-4">Pembelian bahan dicatat di Stok & Resep dan masuk HPP saat terjual. Jangan masukkan pembelian bahan lagi di sini.</p>
  {message&&<p role="status" className="notice mb-4">{message}</p>}
  <form className="panel mb-5" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await addExpense({date,category,description,amount:Number(amount)},actor.id!);setDescription('');setAmount('');setMessage('Pengeluaran tersimpan.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}><h2>Catat Pengeluaran</h2><div className="grid sm:grid-cols-2 gap-3">
  <label>Tanggal pengeluaran<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><label>Kategori biaya<select value={category} onChange={e=>setCategory(e.target.value)}>{['Listrik','Air','Sewa','Gaji','Transportasi','Perlengkapan','Lainnya'].map(c=><option key={c}>{c}</option>)}</select></label>
  <label>Keterangan biaya<input required minLength={3} value={description} onChange={e=>setDescription(e.target.value)}/></label><label>Nominal biaya<input type="number" min="1" required value={amount} onChange={e=>setAmount(e.target.value)}/></label></div><button disabled={busy} className="primary-button mt-4">Simpan pengeluaran</button></form>
  <section className="panel"><h2>Riwayat Pengeluaran</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Nominal</th><th>Status</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.date}</td><td>{r.category}: {r.description}</td><td>{rupiah(r.amount)}</td><td>{r.voidedAt?<span>Batal: {r.voidReason}</span>:<button disabled={busy} className="secondary-button" onClick={async()=>{const reason=prompt('Alasan pembatalan pengeluaran (minimal 5 karakter)');if(!reason)return;setBusy(true);try{await voidExpense(r.id!,reason,actor.id!);setMessage('Pengeluaran dibatalkan; riwayat tetap tersimpan.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Batalkan #{r.id}</button>}</td></tr>)}</tbody></table></div></section></div>;
}
