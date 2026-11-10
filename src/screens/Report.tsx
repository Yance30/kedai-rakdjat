import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, hashPin } from '../db';
import { rupiah } from '../money';
import { BarChart, DonutChart } from '../components/Charts';
import type { Shift } from '../types';

const DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];

const jam = (t: number) =>
  new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

export default function Report({ shift, onClosed }: { shift: Shift; onClosed: () => void }) {
  const orders = useLiveQuery(() => db.orders.where('shiftId').equals(shift.id!).toArray(), [shift.id]) ?? [];
  const payments = useLiveQuery(() => db.payments.where('shiftId').equals(shift.id!).toArray(), [shift.id]) ?? [];
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const paid = orders.filter((o) => o.status === 'paid');
  const openCount = orders.filter((o) => o.status === 'open').length;
  const voidIds = new Set(orders.filter((o) => o.status === 'void').map((o) => o.id));
  const activePayments = payments.filter((p) => !voidIds.has(p.orderId));
  const gross = paid.reduce((s, o) => s + o.total, 0);
  const cashTotal = activePayments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const qrisPayments = activePayments.filter((p) => p.method === 'qris');
  const qrisTotal = qrisPayments.reduce((s, p) => s + p.amount, 0);

  const physical = DENOMS.reduce((s, d) => s + d * (Number(counts[d]) || 0), 0);
  const expected = shift.openingFloat + cashTotal;
  const diff = physical - expected;

  const hourMap = new Map<number, number>();
  for (const o of paid) {
    const h = new Date(o.createdAt).getHours();
    hourMap.set(h, (hourMap.get(h) ?? 0) + o.total);
  }
  const hours = [...hourMap.keys()];
  const hourly = hours.length > 0
    ? Array.from({ length: Math.max(...hours) - Math.min(...hours) + 1 }, (_, i) => {
        const h = Math.min(...hours) + i;
        return { label: `${String(h).padStart(2, '0')}`, value: hourMap.get(h) ?? 0 };
      })
    : [];
  const avgTicket = paid.length > 0 ? Math.round(gross / paid.length) : 0;

  async function close() {
    if (openCount > 0) {
      setError(`Masih ada ${openCount} pesanan meja terbuka. Selesaikan / bayar dulu sebelum tutup shift.`);
      return;
    }
    if (diff !== 0) {
      const owner = await db.staff.where('role').equals('owner').first();
      if (!owner || hashPin(pin) !== owner.pinHash) {
        setError('Ada selisih kas — masukkan PIN owner untuk otorisasi.');
        return;
    }
    }
    await db.shifts.update(shift.id!, {
      status: 'closed',
      closedAt: Date.now(),
      actualCash: physical,
      note: diff !== 0 ? `Selisih ${rupiah(diff)}` : undefined,
    });
    onClosed();
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="font-bold text-xl mb-1">Keuangan & Tutup Shift</h1>
      <p className="text-sm text-gray-500 mb-6">Shift buka pukul {jam(shift.openedAt)}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Omset Kotor" value={rupiah(gross)} />
        <Stat label="Transaksi" value={String(paid.length)} />
        <Stat label="Tunai (sistem)" value={rupiah(cashTotal)} />
        <Stat label="QRIS / Online (sistem)" value={rupiah(qrisTotal)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold mb-1">Pemasukan per Jam</h2>
          <p className="text-xs text-gray-500 mb-3">
            Rata-rata {rupiah(avgTicket)} / transaksi — untuk menilai jam ramai & performa shift.
          </p>
          {hourly.length === 0 ? (
            <p className="text-sm text-gray-400">Belum ada transaksi lunas shift ini.</p>
          ) : (
            <BarChart data={hourly} height={170} />
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold mb-4">Komposisi Pembayaran Shift Ini</h2>
          <DonutChart
            segments={[
              { label: 'Tunai', value: cashTotal, color: '#8a000a' },
              { label: 'QRIS / Online', value: qrisTotal, color: '#d4a017' },
            ]}
            centerLabel="uang masuk"
          />
          <div className="flex justify-between text-sm border-t border-gray-200 pt-2 mt-4">
            <span className="text-gray-500">Total uang masuk (tunai + QRIS)</span>
            <span className="font-bold text-primary">{rupiah(cashTotal + qrisTotal)}</span>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold mb-4">Hitung Fisik Uang Kasir</h2>
          <div className="space-y-2">
            {DENOMS.map((d) => (
              <div key={d} className="flex items-center gap-3">
                <span className="w-24 text-sm text-gray-600">{rupiah(d)}</span>
                <input
                  type="number"
                  min="0"
                  value={counts[d] ?? ''}
                  onChange={(e) => {
                    setCounts((c) => ({ ...c, [d]: e.target.value }));
                    setError('');
                  }}
                  placeholder="0"
                  className="w-20 h-9 rounded-lg border border-gray-300 px-2 text-center"
                />
                <span className="text-xs text-gray-400">lembar/koin</span>
                <span className="ml-auto text-sm font-medium">
                  {rupiah(d * (Number(counts[d]) || 0))}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t border-gray-200 mt-4 pt-3 font-bold">
            <span>Total fisik</span>
            <span className="text-primary">{rupiah(physical)}</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold mb-1">Uang Masuk QRIS / Online</h2>
          <p className="text-xs text-gray-500 mb-4">
            Tercatat saat kasir konfirmasi. Cocokkan total dengan mutasi di aplikasi merchant / soundbox.
          </p>
          {qrisPayments.length === 0 && (
            <p className="text-sm text-gray-400">Belum ada pembayaran QRIS / online shift ini.</p>
          )}
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {qrisPayments.map((p) => (
              <div key={p.id} className="flex justify-between text-sm border-b border-gray-100 pb-2">
                <span className="text-gray-600">Order #{p.orderId} · {jam(p.createdAt)}</span>
                <span className="font-medium">{rupiah(p.amount)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t border-gray-200 mt-4 pt-3 font-bold">
            <span>Total QRIS / online</span>
            <span className="text-primary">{rupiah(qrisTotal)}</span>
          </div>
          <div className="flex justify-between text-sm mt-2">
            <span className="text-gray-500">Total uang masuk (tunai + QRIS)</span>
            <span className="font-semibold">{rupiah(cashTotal + qrisTotal)}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl">
        <h2 className="font-semibold mb-4">Rekonsiliasi & Tutup Shift</h2>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-500">Kas diharapkan (modal + tunai)</span>
          <span className="font-semibold">{rupiah(expected)}</span>
        </div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-500">Hitungan fisik</span>
          <span className="font-semibold">{rupiah(physical)}</span>
        </div>
        <div className={`text-sm mb-4 ${diff === 0 ? 'text-green-700' : 'text-primary-bright'}`}>
          {diff === 0 ? 'Kas seimbang (balanced).' : `Selisih: ${rupiah(diff)}`}
        </div>
        {diff !== 0 && (
          <>
            <label className="text-sm font-medium">PIN owner (otorisasi selisih)</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError(''); }}
              className="w-full h-12 rounded-lg border border-gray-300 px-4 mt-1 mb-3"
            />
          </>
        )}
        {error && <p className="text-sm text-primary-bright mb-3">{error}</p>}
        <button onClick={close} className="w-full h-12 rounded-lg bg-primary text-white font-semibold">
          Tutup Shift & Simpan Z-Report
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-sm">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="font-display font-bold text-xl text-primary tabular-nums">{value}</div>
    </div>
  );
}