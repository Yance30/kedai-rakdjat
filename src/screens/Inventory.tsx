import StockControl from '../components/StockControl';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { adjustStock, saveIngredient, saveRecipe } from '../inventory';
import { rupiah } from '../money';
import type { Ingredient, Staff } from '../types';

const initial: Ingredient = { name: '', unit: 'g', stock: 0, minimum: 0, unitCost: 0, active: 1 };
export default function Inventory({ actor }: { actor: Staff }) {
  const ingredients = useLiveQuery(() => db.ingredients.toArray(), []) ?? [];
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const recipes = useLiveQuery(() => db.recipes.toArray(), []) ?? [];
  const movements = useLiveQuery(() => db.stockMovements.orderBy('id').reverse().limit(50).toArray(), []) ?? [];
  const [form, setForm] = useState<Ingredient>(initial);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [ingredientId, setIngredientId] = useState(''); const [qty, setQty] = useState(''); const [cost, setCost] = useState('');
  const [kind, setKind] = useState<'purchase' | 'adjustment'>('purchase'); const [reason, setReason] = useState('');
  const [productId, setProductId] = useState(''); const [parts, setParts] = useState<{ ingredientId: number; qty: number }[]>([]);
  const [partId, setPartId] = useState(''); const [partQty, setPartQty] = useState('');
  const low = ingredients.filter(i => i.active && i.stock <= i.minimum);
  const recipeCost = parts.reduce((s, p) => s + (ingredients.find(i => i.id === p.ingredientId)?.unitCost ?? 0) * p.qty, 0);
  async function perform(work: () => Promise<unknown>, success: string) {
    if (busy) return; setBusy(true); setMsg('');
    try { await work(); setMsg(success); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  if (actor.role !== 'owner') return <p className="p-6">Akses stok hanya untuk owner.</p>;
  return <div className="screen-page">
    <header className="page-heading"><div><p className="eyebrow">BAHAN & BIAYA</p><h1>Stok dan Resep</h1><p>Catat bahan masuk, atur resep per porsi, dan pantau harga pokok menu.</p></div></header>
    {msg && <p role="status" className="notice mb-5">{msg}</p>}
    <div className="metric-grid"><div className="metric"><p>Bahan aktif</p><strong>{ingredients.filter(i => i.active).length}</strong></div><div className="metric"><p>Stok perlu diisi</p><strong>{low.length}</strong></div><div className="metric"><p>Menu dengan resep</p><strong>{recipes.length} / {products.length}</strong></div><div className="metric"><p>Nilai stok bahan</p><strong>{rupiah(Math.round(ingredients.reduce((s, i) => s + i.stock * i.unitCost, 0)))}</strong></div></div>
    {low.length > 0 && <p className="notice mb-5">Stok menipis: {low.map(i => `${i.name} (${i.stock} ${i.unit})`).join(', ')}.</p>}
    <section className="panel mb-5"><h2>Persediaan Bahan</h2><p className="text-xs text-gray-500 mb-3">Jumlah menggunakan satuan dasar bulat: gram, mililiter, atau buah. Stok berkurang saat pembayaran; pesanan dapur terbuka belum mengurangi stok.</p>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Bahan</th><th>Tersedia</th><th>Batas minimum</th><th>Biaya / satuan</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{ingredients.map(i => <tr key={i.id}><td>{i.name}</td><td>{i.stock.toLocaleString('id-ID')} {i.unit}</td><td>{i.minimum} {i.unit}</td><td>Rp {i.unitCost.toLocaleString('id-ID', { maximumFractionDigits: 4 })}</td><td><span className={`status-badge ${i.stock <= i.minimum ? 'status-warning' : ''}`}>{!i.active ? 'Nonaktif' : i.stock <= i.minimum ? 'Stok menipis' : 'Tersedia'}</span></td><td><button className="secondary-button" onClick={() => setForm(i)}>Edit bahan</button></td></tr>)}</tbody></table></div>
      {!ingredients.length && <p className="empty-state">Belum ada bahan. Tambahkan bahan pertama di formulir berikut.</p>}
    </section>
    <div className="grid xl:grid-cols-2 gap-5 mb-5">
      <form className="panel" onSubmit={e => { e.preventDefault(); void perform(async () => { await saveIngredient(form, actor.id!); setForm(initial); }, 'Bahan tersimpan.'); }}><h2>{form.id ? 'Edit Bahan' : 'Tambah Bahan'}</h2>
        <div className="grid sm:grid-cols-2 gap-3"><label>Nama bahan<input aria-label="Nama bahan" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Contoh: Kopi arabika" /></label>
          <label>Satuan dasar<select aria-label="Satuan bahan" disabled={!!form.id} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value as Ingredient['unit'] })}><option value="g">Gram (g)</option><option value="ml">Mililiter (ml)</option><option value="pcs">Buah (pcs)</option></select></label>
          {!form.id && <label>Stok awal<input aria-label="Stok awal" type="number" min="0" step="1" required value={form.stock} onChange={e => setForm({ ...form, stock: Number(e.target.value) })} /></label>}
          <label>Stok minimum<input aria-label="Stok minimum" type="number" min="0" step="1" required value={form.minimum} onChange={e => setForm({ ...form, minimum: Number(e.target.value) })} /></label>
          <label>Biaya per {form.unit} (Rp)<input aria-label="Biaya per satuan" type="number" min="0" step="any" required value={form.unitCost} onChange={e => setForm({ ...form, unitCost: Number(e.target.value) })} /></label>
          {form.id && <label>Status<select value={form.active} onChange={e => setForm({ ...form, active: Number(e.target.value) as 0 | 1 })}><option value="1">Aktif</option><option value="0">Nonaktif</option></select></label>}
        </div><div className="flex gap-2 mt-4"><button disabled={busy} className="primary-button">Simpan bahan</button>{form.id && <button type="button" className="secondary-button" onClick={() => setForm(initial)}>Batal edit</button>}</div>
      </form>
      <form className="panel" onSubmit={e => { e.preventDefault(); void perform(async () => { if (!ingredientId || !qty || (kind === 'purchase' && !cost)) throw new Error('Lengkapi bahan, jumlah, dan biaya.'); await adjustStock(Number(ingredientId), Number(qty), kind, reason, actor.id!, kind === 'purchase' ? Number(cost) : undefined); setQty(''); setCost(''); setReason(''); }, 'Pergerakan stok tercatat.'); }}><h2>Bahan Masuk & Koreksi</h2><div className="grid sm:grid-cols-2 gap-3">
        <label>Bahan<select aria-label="Bahan pergerakan stok" required value={ingredientId} onChange={e => setIngredientId(e.target.value)}><option value="">Pilih bahan</option>{ingredients.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label>
        <label>Jenis<select aria-label="Jenis pergerakan" value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="purchase">Pembelian</option><option value="adjustment">Koreksi (+ / −)</option></select></label>
        <label>Jumlah satuan dasar<input aria-label="Jumlah pergerakan" type="number" step="1" required min={kind === 'purchase' ? 1 : undefined} value={qty} onChange={e => setQty(e.target.value)} /></label>
        {kind === 'purchase' && <label>Total biaya pembelian (Rp)<input aria-label="Total biaya pembelian" type="number" min="0" step="1" required value={cost} onChange={e => setCost(e.target.value)} /></label>}
        <label className="sm:col-span-2">Alasan / referensi<input aria-label="Alasan stok" required minLength={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Contoh: Nota supplier 012 / bahan rusak" /></label>
      </div><p className="text-xs text-gray-500 mt-3">Pembelian memperbarui biaya rata-rata tertimbang. Gunakan koreksi negatif untuk bahan terbuang.</p><button disabled={busy} className="primary-button mt-4">Catat pergerakan</button></form>
    </div>
    <section className="panel mb-5"><h2>Resep per Porsi</h2><label>Menu<select aria-label="Menu resep" value={productId} onChange={e => { setProductId(e.target.value); setParts(recipes.find(r => r.productId === Number(e.target.value))?.ingredients ?? []); }}><option value="">Pilih menu</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 mt-3 items-end"><label>Bahan resep<select aria-label="Bahan resep" value={partId} onChange={e => setPartId(e.target.value)}><option value="">Pilih bahan</option>{ingredients.filter(i => i.active).map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label><label>Jumlah per porsi<input aria-label="Jumlah resep" type="number" min="1" step="1" value={partQty} onChange={e => setPartQty(e.target.value)} /></label><button className="secondary-button" onClick={() => { const quantity = Number(partQty); if (!partId || !Number.isSafeInteger(quantity) || quantity < 1) { setMsg('Pilih bahan dan jumlah bulat lebih dari nol.'); return; } setParts([...parts.filter(p => p.ingredientId !== Number(partId)), { ingredientId: Number(partId), qty: quantity }]); setPartId(''); setPartQty(''); }}>Tambah ke resep</button></div>
      <div className="mt-4 space-y-2">{parts.map(p => { const i = ingredients.find(i => i.id === p.ingredientId); return <div key={p.ingredientId} className="flex items-center gap-3 border-b py-2"><span className="flex-1">{i?.name} · {p.qty} {i?.unit}</span><span>{rupiah(Math.round(p.qty * (i?.unitCost ?? 0)))}</span><button className="secondary-button" onClick={() => setParts(parts.filter(row => row.ingredientId !== p.ingredientId))}>Hapus dari resep</button></div>; })}</div>
      <div className="flex flex-wrap gap-4 items-center mt-4"><button disabled={busy || !productId || !parts.length} className="primary-button" onClick={() => perform(() => saveRecipe({ productId: Number(productId), ingredients: parts }, actor.id!), 'Resep tersimpan untuk transaksi berikutnya.')}>Simpan resep</button><strong>HPP bahan per porsi: {rupiah(Math.round(recipeCost))}</strong></div>
    </section>
    <StockControl actorId={actor.id!}/><section className="panel"><h2>50 Pergerakan Terakhir</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Waktu</th><th>Bahan</th><th>Jumlah</th><th>Jenis</th><th>Alasan</th></tr></thead><tbody>{movements.map(m => <tr key={m.id}><td>{new Date(m.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td><td>{ingredients.find(i => i.id === m.ingredientId)?.name}</td><td>{m.qty > 0 ? '+' : ''}{m.qty}</td><td>{({opening:'Awal',purchase:'Pembelian',adjustment:'Koreksi',sale:'Penjualan',return:'Pengembalian',waste:'Terbuang',stocktake:'Opname'})[m.kind]}</td><td>{m.reason}</td></tr>)}</tbody></table></div></section>
  </div>;
}
