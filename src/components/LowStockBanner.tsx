import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { lowStockSummary } from '../inventory';

/** Warns about ingredients at or below their minimum, so the counter knows before taking the order. */
export default function LowStockBanner({ onOpen, className = '' }: { onOpen?: () => void; className?: string }) {
  const summary = useLiveQuery(async () => lowStockSummary(await db.ingredients.toArray(), await db.recipes.toArray(), await db.products.toArray()), []);
  if (!summary?.low.length) return null;
  const short = summary.affected.filter(a => a.short).map(a => a.name);
  const thin = summary.affected.filter(a => !a.short).map(a => a.name);
  return (
    <div role="status" className={`bg-amber-50 border-amber-200 text-amber-900 text-sm flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <strong>Stok menipis:</strong>
      <span>{summary.low.map(i => `${i.name} (${i.stock.toLocaleString('id-ID')} ${i.unit})`).join(', ')}</span>
      {short.length > 0 && <span className="font-semibold text-primary-bright">Bahan tidak cukup untuk: {short.join(', ')}</span>}
      {thin.length > 0 && <span>Menu terdampak: {thin.join(', ')}</span>}
      {onOpen && <button onClick={onOpen} className="underline font-semibold ml-auto">Buka Stok & Resep</button>}
    </div>
  );
}
