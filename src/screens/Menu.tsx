import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { saveProduct } from '../operations';
import { rupiah } from '../money';
import type { Product, Staff } from '../types';
const empty:Product={name:'',category:'Food',price:0,active:1,soldOut:false};
export default function Menu({actor}:{actor:Staff}) {
  const products=useLiveQuery(()=>db.products.toArray(),[])??[];
  const [form,setForm]=useState<Product>(empty),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function photo(file?:File) {
    if(!file)return;
    setBusy(true);
    try {
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10000000)throw new Error('Pilih foto JPEG, PNG atau WebP maksimal 10 MB.');
      const bitmap=await createImageBitmap(file), canvas=document.createElement('canvas');
      const scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      const data=canvas.toDataURL('image/jpeg',0.75);
      if(data.length>500000)throw new Error('Foto terlalu besar setelah diperkecil. Pilih foto lain.');
      setForm(f=>({...f,photo:data}));
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="screen-page"><header className="page-heading"><div><p className="eyebrow">KATALOG KEDAI</p><h1>Kelola Menu</h1><p>Harga baru berlaku untuk item yang ditambahkan berikutnya. Pesanan tersimpan mempertahankan harga asal.</p></div></header>
    {message&&<p role="status" className="notice mb-4">{message}</p>}
    <form className="panel mb-5" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await saveProduct(form,actor.id!);setForm(empty);setMessage('Menu berhasil disimpan.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>
      <h2>{form.id?'Edit Menu':'Tambah Menu'}</h2><div className="grid sm:grid-cols-3 gap-3">
      <label>Nama menu<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>Kategori menu<input required value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></label>
      <label>Harga menu<input type="number" min="1" required value={form.price||''} onChange={e=>setForm({...form,price:Number(e.target.value)})}/></label>
      <label>Status menu<select value={form.active} onChange={e=>setForm({...form,active:Number(e.target.value) as 0|1})}><option value="1">Aktif</option><option value="0">Diarsipkan</option></select></label>
      <label>Ketersediaan<select value={form.soldOut?'habis':'tersedia'} onChange={e=>setForm({...form,soldOut:e.target.value==='habis'})}><option value="tersedia">Tersedia</option><option value="habis">Habis sementara</option></select></label>
      <label>Foto menu<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>void photo(e.target.files?.[0])}/></label></div>
      {form.photo&&<div className="flex items-center gap-3 mt-3"><img src={form.photo} alt="Pratinjau menu" className="w-24 h-24 object-cover rounded-xl"/><button type="button" className="secondary-button" onClick={()=>setForm({...form,photo:undefined})}>Hapus foto</button></div>}
      <div className="flex gap-2 mt-4"><button disabled={busy} className="primary-button">Simpan menu</button><button type="button" className="secondary-button" onClick={()=>setForm(empty)}>Formulir baru</button></div>
    </form><section className="panel"><h2>Daftar Menu</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Menu</th><th>Kategori</th><th>Harga</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.category}</td><td>{rupiah(p.price)}</td><td>{!p.active?'Diarsipkan':p.soldOut?'Habis':'Tersedia'}</td><td><button className="secondary-button" onClick={()=>{setForm(p);setMessage('');}}>Edit {p.name}</button></td></tr>)}</tbody></table></div></section>
  </div>;
}
