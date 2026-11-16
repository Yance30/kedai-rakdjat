import { useState } from 'react';
import { haptic } from '../../feedback';
import { rupiah } from '../../money';

export default function PayModal({
  busy,
  total,
  qrisImage,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  total: number;
  qrisImage?: string;
  onCancel: () => void;
  onConfirm: (method: 'cash' | 'qris', tendered: number) => void;
}) {
  const [method, setMethod] = useState<'cash' | 'qris'>('cash');
  const [tendered, setTendered] = useState('');
  // Digits only, capped at 10 so the amount stays a safe integer, without leading zeros.
  const digits = (v: string) => v.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10);
  const cashValid = Number(tendered) >= total;

  return (
    <div className="kr-backdrop fixed inset-0 bg-maroon-deep/50 backdrop-blur-sm grid place-items-center z-50">
      <div className="w-[28rem] bg-white rounded-3xl p-6 shadow-xl kr-modal">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-display font-bold text-lg">Pembayaran</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="text-center text-4xl font-display font-bold text-primary mb-6 tabular-nums">{rupiah(total)}</div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setMethod('cash')}
            className={`h-11 rounded-lg font-medium ${method === 'cash' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Tunai
          </button>
          <button
            onClick={() => setMethod('qris')}
            className={`h-11 rounded-lg font-medium ${method === 'qris' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            QRIS
          </button>
        </div>
        {method === 'cash' ? (
          <div key="cash" className="kr-fade-up">
            <label className="relative block mb-3">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg">Rp</span>
              <input
                aria-label="Uang diterima"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={tendered ? Number(tendered).toLocaleString('id-ID') : ''}
                onChange={(e) => setTendered(digits(e.target.value))}
                placeholder="Uang diterima"
                className="w-full h-12 rounded-lg border border-gray-300 pl-12 pr-4 text-lg font-semibold tabular-nums"
              />
            </label>
            <div role="group" className="grid grid-cols-3 gap-1.5 mb-3" aria-label="Papan angka uang diterima">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'].map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-label={k === '⌫' ? 'Hapus angka' : `Angka ${k}`}
                  onClick={() => { haptic(8); setTendered((t) => k === '⌫' ? t.slice(0, -1) : digits(t + k)); }}
                  className="h-10 rounded-lg bg-gray-100 hover:bg-gray-200 active:bg-primary active:text-white font-semibold"
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap mb-4">
              <button onClick={() => setTendered(String(total))} className="px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-sm">Uang Pas</button>
              {[50000, 100000, 200000].map((v) => (
                <button key={v} onClick={() => setTendered(String(v))} className="px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-sm">
                  {rupiah(v)}
                </button>
              ))}
            </div>
            {cashValid && (
              <div className="text-sm text-gray-600 mb-4">Kembalian: <span key={tendered} className="kr-pop font-semibold text-green-700">{rupiah(Number(tendered) - total)}</span></div>
            )}
          </div>
        ) : (
          <div key="qris" className="kr-zoom rounded-xl border-2 border-dashed border-gray-300 p-6 text-center mb-4">
            {qrisImage ? (
              <>
                <img src={qrisImage} alt="QRIS Kedai Rakdjat" className="h-64 w-64 object-contain mx-auto mb-1 bg-white" />
                <div className="text-xs text-gray-500 mb-3">KEDAI RAKDJAT · NMID ID1026487869343</div>
              </>
            ) : (
              <div className="font-semibold mb-1">QRIS Kedai Rakdjat</div>
            )}
            <p className="text-sm text-gray-500">Tunjukkan QRIS kedai ke pelanggan. Konfirmasi hanya setelah bukti pembayaran masuk di aplikasi merchant / soundbox.</p>
          </div>
        )}
        <button
          onClick={() => onConfirm(method, method === 'cash' ? Number(tendered) : total)}
          disabled={busy || (method === 'cash' && !cashValid)}
          className="w-full h-12 rounded-lg bg-primary text-white font-semibold disabled:opacity-40"
        >
          Konfirmasi Pembayaran
        </button>
      </div>
    </div>
  );
}
