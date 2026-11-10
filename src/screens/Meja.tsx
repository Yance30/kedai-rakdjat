import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { rupiah } from '../money';
import type { DiningTable } from '../types';

const STATUS: Record<DiningTable['status'], { label: string; cls: string; dot: string }> = {
  available: { label: 'Kosong', cls: 'bg-white border-gray-200 text-ink', dot: 'bg-green-500' },
  occupied: { label: 'Terisi', cls: 'bg-primary/5 border-primary/30 text-primary', dot: 'bg-primary' },
  cleaning: { label: 'Bersih-bersih', cls: 'bg-gray-50 border-gray-300 border-dashed text-gray-500', dot: 'bg-gray-400' },
};

export default function Meja({ onOpen }: { onOpen: (tableId: number) => void }) {
  const tables = useLiveQuery(() => db.meja.orderBy('id').toArray(), []) ?? [];
  const openOrders = useLiveQuery(() => db.orders.where('status').equals('open').toArray(), []) ?? [];

  async function markClean(id: number) {
    await db.meja.update(id, { status: 'available' });
  }

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-bold text-2xl">Denah Meja</h1>
        <div className="flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> Kosong</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-primary" /> Terisi</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-400" /> Bersih-bersih</span>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">Ketuk meja kosong untuk mulai pesanan, atau meja terisi untuk melanjutkan / membayar.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {tables.map((t) => {
          const order = openOrders.find((o) => o.tableId === t.id);
          const s = STATUS[t.status];
          return (
            <div key={t.id} className={`rounded-2xl border-2 p-5 flex flex-col shadow-sm transition hover:shadow-md ${s.cls}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-display font-bold text-3xl">{t.name}</span>
                <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-white/70">
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                  {s.label}
                </span>
              </div>
              {t.status === 'occupied' && order ? (
                <>
                  <div className="text-sm mb-3">Order #{order.id} · <span className="font-semibold tabular-nums">{rupiah(order.total)}</span></div>
                  <button
                    onClick={() => onOpen(t.id!)}
                    className="mt-auto h-11 rounded-xl bg-gradient-to-r from-primary to-primary-bright text-white font-semibold shadow-sm"
                  >
                    Lanjut / Bayar
                  </button>
                </>
              ) : t.status === 'cleaning' ? (
                <button
                  onClick={() => markClean(t.id!)}
                  className="mt-auto h-11 rounded-xl bg-gray-700 text-white font-semibold"
                >
                  Selesai Bersih
                </button>
              ) : (
                <button
                  onClick={() => onOpen(t.id!)}
                  className="mt-auto h-11 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700"
                >
                  Buka Meja
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}