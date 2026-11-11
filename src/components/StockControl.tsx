import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { recordStock } from '../operations';
export default function StockControl({actorId}:{actorId:number}) {
  const ingredients=useLiveQuery(()=>db.ingredients.toArray(),[])??[];
  const [id,setId]=useState(''),[expected,setExpected]=useState(0),[kind,setKind]=useState<'waste'|'stocktake'>('waste'),[value,setValue]=useState(''),[reason,setReason]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  return <form className="panel mb-5" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await recordStock(Number(id),Number(value),kind,expected,reason,actorId);setId('');setValue('');setReason('');setMessage('Pencatatan stok tersimpan.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}><h2>Bahan Terbuang & Stok Opname</h2><p className="text-sm text-gray-500 mb-4">Pilih bahan setelah menghentikan sementara transaksi bahan tersebut. Jika saldo berubah, pilih ulang bahan dan hitung kembali.</p>
  <div className="grid sm:grid-cols-2 gap-3"><label>Jenis pencatatan<select aria-label="Jenis pencatatan" value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setValue('');}}><option value="waste">Bahan terbuang / rusak</option><option value="stocktake">Stok opname fisik</option></select></label>
  <label>Bahan yang dihitung<select aria-label="Bahan yang dihitung" required value={id} onChange={e=>{setId(e.target.value);setExpected(ingredients.find(i=>i.id===Number(e.target.value))?.stock??0);}}><option value="">Pilih bahan</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label>
  <label>{kind==='waste'?'Jumlah terbuang':'Jumlah fisik aktual'}<input type="number" min={kind==='waste'?1:0} required value={value} onChange={e=>setValue(e.target.value)}/></label><label>Alasan pencatatan<input required minLength={5} value={reason} onChange={e=>setReason(e.target.value)}/></label></div>
  {id&&<p className="text-sm mt-3">Saldo saat dipilih: {expected}. Saldo setelah pencatatan: {kind==='waste'?expected-Number(value):Number(value)}.</p>}<button disabled={busy||!id} className="primary-button mt-4">Simpan pencatatan stok</button>{message&&<p role="status" className="notice mt-3">{message}</p>}</form>;
}
