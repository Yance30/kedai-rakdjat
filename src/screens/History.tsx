import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, hashPin } from '../db';
import { rupiah } from '../money';
import type { Shift } from '../types';

const tgl = (t: number) => new Date(t).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function History({ shift }: { shift: Shift }) {
  const orders = useLiveQuery(() => db.orders.where('shiftId').equals(shift.id!).and((o) => o.status !== 'open').toArray(), [shift.id]) ?? [];
  const closed = useLiveQuery(() => db.shifts.where('status').equals('closed').toArray(), []) ?? [];
  const allOrders = useLiveQuery(() => db.orders.toArray(), []) ?? [];
  const staff = useLiveQuery(() => db.staff.toArray(), []) ?? [];
  const [voidId, setVoidId] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState<number | null>(null);

  async function doVoid() {
    const owner = await db.staff.where('role').equals('owner').first();
    if (!owner || hashPin(pin) !== owner.pinHash) {
      setErr('PIN owner salah.');
      return;
    }
    await db.orders.update(voidId!, { status: 'void' });
    setVoidId(null);
    setPin('');
    setErr('');
  }

  const sorted = [...closed].sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="font-bold text-xl mb-6">Riwayat Transaksi & Shift</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="font-semibold mb-4">Transaksi Shift Berjalan</h2>
        {orders.length === 0 && <p className="text-sm text-gray-400">Belum ada transaksi.</p>}
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.id} className="flex items-center gap-3 border-b border-gray-100 pb-2">
              <div className="flex-1">
                <span className="text-sm font-medium">Order #{o.id}</span>
                <span className="text-xs text-gray-500 ml-2">{tgl(o.createdAt)}</span>
              </div>
              <span className="text-sm font-semibold">{rupiah(o.total)}</span>
              {o.status === 'void' ? (
                <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-primary-bright">VOID</span>
              ) : (
                <button
                  onClick={() => { setVoidId(o.id!); setErr(''); }}
                  className="text-xs px-2 py-1 rounded-full bg-gray-100 hover:bg-red-50 text-gray-600"
                >
                  Void
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold mb-4">Shift Tertutup</h2>
        {sorted.length === 0 && <p className="text-sm text-gray-400">Belum ada shift tertutup.</p>}
        <div className="space-y-3">
          {sorted.map((s) => {
            const so = allOrders.filter((o) => o.shiftId === s.id && o.status !== 'open');
            const paid = so.filter((o) => o.status === 'paid');
            const gross = paid.reduce((x, o) => x + o.total, 0);
            const name = staff.find((st) => st.id === s.staffId)?.name ?? '-';
            return (
              <div key={s.id} className="border border-gray-100 rounded-lg p-3">
                <button onClick={() => setDetail(detail === s.id ? null : s.id!)} className="w-full flex items-center gap-3 text-left">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{tgl(s.openedAt)} → {s.closedAt ? tgl(s.closedAt) : '-'}</div>
                    <div className="text-xs text-gray-500">{name} · {paid.length} transaksi · {so.filter((o) => o.status === 'void').length} void</div>
                  </div>
                  <span className="font-semibold text-primary">{rupiah(gross)}</span>
                </button>
                {s.note && <div className="text-xs text-primary-bright mt-1">{s.note}</div>}
                {detail === s.id && (
                  <div className="mt-3 space-y-1 border-t border-gray-100 pt-2">
                    {so.map((o) => (
                      <div key={o.id} className="flex justify-between text-xs text-gray-600">
                        <span>Order #{o.id} · {tgl(o.createdAt)} {o.status === 'void' && '(VOID)'}</span>
                        <span>{rupiah(o.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {voidId !== null && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center z-50">
          <div className="w-80 bg-white rounded-2xl p-6">
            <h2 className="font-bold mb-1">Void Order #{voidId}</h2>
            <p className="text-xs text-gray-500 mb-4">Pembatalan mengurangi omset & kas shift ini. Butuh PIN owner.</p>
            <input
              type="password"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setErr(''); }}
              placeholder="PIN owner"
              className="w-full h-11 rounded-lg border border-gray-300 px-3 mb-2"
            />
            {err && <p className="text-xs text-primary-bright mb-2">{err}</p>}
            <div className="flex gap-2">
              <button onClick={doVoid} className="flex-1 h-11 rounded-lg bg-primary text-white font-semibold">Void</button>
              <button onClick={() => setVoidId(null)} className="flex-1 h-11 rounded-lg bg-gray-100">Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}