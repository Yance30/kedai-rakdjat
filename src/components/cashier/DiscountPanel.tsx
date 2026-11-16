import { useEffect, useState } from 'react';
import { rupiah } from '../../money';

/** Owner-approved discount state. It resets whenever `resetKey` changes (the bill being paid changed). */
export function useDiscount(subtotal: number, resetKey: string) {
  const [mode, setMode] = useState('rupiah');
  const [input, setInput] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  useEffect(() => { setInput(''); setReason(''); setPin(''); }, [resetKey]);
  const amount = mode === 'persen' ? Math.round(subtotal * Number(input) / 100) : Number(input);
  const valid = Number.isSafeInteger(amount) && amount >= 0 && (subtotal === 0 ? amount === 0 : amount < subtotal) && Number(input) >= 0;
  return { mode, setMode, input, setInput, reason, setReason, pin, setPin, amount, valid, clear: () => { setInput(''); setPin(''); } };
}

export default function DiscountPanel({ d }: { d: ReturnType<typeof useDiscount> }) {
  return (
    <details className="mt-3 text-sm rounded-xl border border-gray-200 px-3">
      <summary className="cursor-pointer py-2.5 font-medium text-gray-700">
        Diskon dengan PIN owner{d.amount > 0 && <span className="ml-2 text-xs font-semibold text-primary">−{rupiah(d.amount)}</span>}
      </summary>
      <div className="space-y-2 pb-3">
        <div className="grid grid-cols-2 gap-2">
          <label>Jenis diskon
            <select aria-label="Jenis diskon" value={d.mode} onChange={e => { d.setMode(e.target.value); d.setInput(''); }}>
              <option value="rupiah">Rupiah</option><option value="persen">Persen</option>
            </select>
          </label>
          <label>Nilai diskon
            <input aria-label="Nilai diskon" type="number" min="0" inputMode="numeric" placeholder={d.mode === 'persen' ? '%' : 'Rp'} value={d.input} onChange={e => d.setInput(e.target.value)} />
          </label>
        </div>
        {d.amount > 0 && (
          <div className="kr-fade-up space-y-2">
            <label>Alasan diskon<input aria-label="Alasan diskon" placeholder="mis. pelanggan tetap" value={d.reason} onChange={e => d.setReason(e.target.value)} /></label>
            <label>PIN owner diskon<input aria-label="PIN owner diskon" type="password" inputMode="numeric" autoComplete="off" value={d.pin} onChange={e => d.setPin(e.target.value)} /></label>
            <p className="text-xs text-gray-500">Diskon diterapkan sebelum service dan pajak; persetujuan dicatat saat pembayaran. PIN tidak disimpan.</p>
          </div>
        )}
        {!d.valid && <p role="alert" className="kr-shake text-xs text-primary-bright">Diskon harus lebih kecil dari subtotal.</p>}
      </div>
    </details>
  );
}
