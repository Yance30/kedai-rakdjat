import { useState, type ReactNode } from 'react';
import { rupiah } from '../../money';
import type { Product } from '../../types';

/** Searchable, category-filtered menu cards. `toolbar` sits next to the search box. */
export default function ProductGrid({ products, onAdd, toolbar }: { products: Product[]; onAdd: (p: Product) => void; toolbar?: ReactNode }) {
  const [cat, setCat] = useState('Semua');
  const [q, setQ] = useState('');
  const cats = ['Semua', ...Array.from(new Set(products.map((p) => p.category)))];
  const shown = products.filter((p) => (cat === 'Semua' || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="flex gap-2 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari menu..."
          className="flex-1 h-11 rounded-xl border border-gray-200 bg-white px-4 shadow-sm"
        />
        {toolbar}
      </div>
      <div className="flex gap-2 flex-wrap mb-6">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-4 py-2 rounded-full text-sm font-medium ${cat === c ? 'bg-primary text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:border-primary/40'}`}
          >
            {c}
          </button>
        ))}
      </div>
      {shown.length === 0 && products.length > 0 && (
        <div className="empty-state kr-fade-up">
          Tidak ada menu yang cocok dengan “{q}”.{' '}
          <button className="underline text-primary" onClick={() => { setQ(''); setCat('Semua'); }}>Tampilkan semua</button>
        </div>
      )}
      <div key={cat} className="kr-stagger grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {shown.map((p) => (
          <div key={p.id} className={`kr-card bg-white rounded-2xl border border-gray-200/80 p-4 flex flex-col shadow-sm hover:shadow-md hover:-translate-y-0.5 ${p.soldOut ? 'opacity-60' : ''}`}>
            <div className="h-28 rounded-xl overflow-hidden mb-3">
              {p.photo ? (
                <img src={p.photo} alt={p.name} className="kr-card-media h-full w-full object-cover" />
              ) : (
                <div className="kr-card-media h-full bg-gradient-to-br from-maroon to-primary grid place-items-center text-brass-soft font-display font-semibold text-xl px-2 text-center">
                  {p.name.split(' ')[0]}
                </div>
              )}
            </div>
            <div className="font-semibold truncate">{p.name}</div>
            <div className="text-primary font-bold mb-3 tabular-nums">{rupiah(p.price)}</div>
            <button
              disabled={p.soldOut}
              onClick={() => onAdd(p)}
              className="mt-auto h-10 rounded-xl bg-primary/5 text-primary border border-primary/15 font-semibold hover:bg-primary hover:text-white"
            >
              {p.soldOut ? 'Habis' : '+ Tambah'}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
