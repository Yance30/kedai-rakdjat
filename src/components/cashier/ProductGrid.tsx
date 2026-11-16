import { useState, type ReactNode } from 'react';
import { rupiah } from '../../money';
import type { Product } from '../../types';

/**
 * Menu as large tap targets without photos: the whole card adds the item. Items are grouped by
 * category; search and category tabs stay pinned while scrolling. Enter adds the only search match.
 */
export default function ProductGrid({ products, onAdd, inCart, toolbar }: {
  products: Product[];
  onAdd: (p: Product) => void;
  /** Quantity of each product already in the cart, by product id. */
  inCart: Record<number, number>;
  toolbar?: ReactNode;
}) {
  const [cat, setCat] = useState('Semua');
  const [q, setQ] = useState('');
  const categories = Array.from(new Set(products.map((p) => p.category)));
  const query = q.trim().toLowerCase();
  const shown = products.filter((p) => (cat === 'Semua' || p.category === cat) && p.name.toLowerCase().includes(query));
  const groups = categories.map((c) => ({ c, items: shown.filter((p) => p.category === c) })).filter((g) => g.items.length);
  const available = shown.filter((p) => !p.soldOut);

  return (
    <>
      <div className="menu-sticky sticky top-0 z-10 pt-5 pb-3 mb-2 bg-surface/95 backdrop-blur">
        <div className="flex gap-2 mb-3">
          <label className="relative flex-1">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('');
                if (e.key === 'Enter' && query && available.length === 1) { onAdd(available[0]); setQ(''); }
              }}
              placeholder="Cari menu..."
              aria-label="Cari menu"
              className="w-full h-12 rounded-xl border border-gray-200 bg-white pl-11 pr-4 text-[15px] shadow-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </label>
          {toolbar}
        </div>
        <div role="tablist" aria-label="Kategori menu" className="flex gap-2 overflow-x-auto pb-1 -mb-1 [scrollbar-width:none]">
          {['Semua', ...categories].map((c) => {
            const count = c === 'Semua' ? products.length : products.filter((p) => p.category === c).length;
            const active = cat === c;
            return (
              <button
                key={c}
                role="tab"
                aria-selected={active}
                onClick={() => setCat(c)}
                className={`shrink-0 h-10 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${active ? 'bg-maroon text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:border-primary/40 hover:text-primary'}`}
              >
                {c} <span className={`ml-1 text-xs font-medium ${active ? 'text-white/70' : 'text-gray-400'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 && products.length > 0 && (
        <div className="empty-state kr-fade-up">
          Tidak ada menu yang cocok dengan “{q}”.{' '}
          <button className="underline text-primary" onClick={() => { setQ(''); setCat('Semua'); }}>Tampilkan semua</button>
        </div>
      )}

      <div key={cat} className="space-y-6">
        {groups.map(({ c, items }) => (
          <section key={c} aria-label={c}>
            {(cat === 'Semua' || query) && (
              <h2 className="mb-2.5 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
                {c}<span className="h-px flex-1 bg-gray-200" />
              </h2>
            )}
            <div className="kr-stagger grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5">
              {items.map((p) => {
                const qty = inCart[p.id!] ?? 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={p.soldOut}
                    onClick={() => onAdd(p)}
                    aria-label={p.soldOut ? `${p.name} habis` : `Tambah ${p.name} ke pesanan`}
                    className={`group relative flex min-h-[88px] items-stretch gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${qty ? 'border-primary ring-1 ring-primary/30' : 'border-gray-200 hover:border-primary/40 hover:shadow-md'}`}
                  >
                    {p.photo && <img src={p.photo} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
                    <span className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                      <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{p.name}</span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[15px] font-bold tabular-nums text-primary">{p.soldOut ? 'Habis' : rupiah(p.price)}</span>
                        {!p.soldOut && (
                          <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-lg font-bold leading-none text-primary transition-colors group-hover:bg-primary group-hover:text-white">+</span>
                        )}
                      </span>
                    </span>
                    {qty > 0 && (
                      <span key={qty} aria-label={`${qty} di keranjang`} className="kr-pop absolute -right-2 -top-2 grid h-7 min-w-7 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-white shadow ring-2 ring-white">{qty}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
