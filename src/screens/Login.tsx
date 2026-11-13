import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { authenticatePin, changePin } from '../auth';
import { db } from '../db';
import type { Staff } from '../types';

export default function Login({ onLogin, onCloud }: { onLogin: (s: Staff) => void; onCloud: () => void }) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Staff | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [intro, setIntro] = useState(true);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  // Staff are identified by PIN alone, so no names are listed here. Only whether untouched demo
  // accounts still exist is read, to show the first-time hint; PIN hashes stay out of component state.
  const demo = useLiveQuery(async () => (await db.staff.toArray()).some(s => !s.pinHash.startsWith('pbkdf2$')), []) ?? false;

  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 1950);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearTimeout(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  async function submit() {
    if (busy || pin.length < 4) return;
    setBusy(true);
    try {
      const s = await authenticatePin(pin);
      if (s.mustChangePin) setPending(s); else onLogin(s);
    } catch (e) { setError((e as Error).message); setPin(''); }
    finally { setBusy(false); }
  }
  if (pending) return <div className="h-full grid place-items-center p-6"><form className="max-w-sm space-y-4" onSubmit={async e => {
    e.preventDefault(); if (busy) return; setBusy(true);
    try {
      if (newPin !== confirmPin) throw new Error('Konfirmasi PIN tidak sama.');
      await changePin(pending.id!, newPin);
      onLogin({ ...pending, mustChangePin: false });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}><h1 className="text-xl font-bold">Buat PIN pribadi terlebih dahulu</h1><p>{pending.name}, PIN ini sementara. Buat PIN baru yang hanya Anda ketahui; PIN ini dipakai untuk login berikutnya.</p>
    <input aria-label="PIN baru" className="border rounded p-3 w-full" type="password" inputMode="numeric" placeholder="PIN baru (4–6 angka)" value={newPin} onChange={e => setNewPin(e.target.value)} />
    <input aria-label="Ulangi PIN" className="border rounded p-3 w-full" type="password" inputMode="numeric" placeholder="Ulangi PIN" value={confirmPin} onChange={e => setConfirmPin(e.target.value)} />
    {error && <p role="alert">{error}</p>}<button disabled={busy} className="bg-primary text-white rounded p-3">Simpan PIN & masuk</button>
  </form></div>;

  return (
    <div className="h-full relative overflow-hidden bg-white">
      {intro && (
        <div className="kr-intro absolute inset-0 z-50 bg-primary grid place-items-center">
          <div className="kr-zoom text-center">
            <div className="kr-glow w-20 h-20 rounded-2xl bg-white text-primary grid place-items-center font-bold text-3xl mx-auto mb-4 shadow-lg">KR</div>
            <div className="text-white font-bold text-3xl tracking-wide">Kedai Rakdjat</div>
            <div className="text-white/70 text-sm mt-2 tracking-widest uppercase">Enterprise POS</div>
          </div>
        </div>
      )}

      <div className="h-full flex">
        <div className="kr-slide-left relative hidden md:block flex-1 min-w-0">
          <img src={`${import.meta.env.BASE_URL}login-bg.png`} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-black/25" />
          <div className="absolute inset-0 grid place-items-center p-8">
            <div className="kr-fade-up bg-white/95 backdrop-blur rounded-2xl shadow-2xl p-8 max-w-sm text-center" style={{ animationDelay: '0.35s' }}>
              <h1 className="text-primary font-bold text-3xl mb-3">Kedai Rakdjat</h1>
              <p className="text-gray-600 text-sm leading-relaxed mb-6">
                Pelayanan hangat, transaksi tertata. Kelola pesanan, kas, dan persediaan kedai dalam satu tempat.
              </p>
              <div className="flex justify-center gap-6 text-[11px] text-gray-500 font-semibold tracking-wide">
                <span>TRANSAKSI CEPAT</span>
                <span>TETAP JALAN OFFLINE</span>
              </div>
            </div>
          </div>
        </div>

        <div className="kr-slide-right w-full md:w-[420px] shrink-0 bg-white flex flex-col items-center justify-center p-8 overflow-y-auto">
          <div className="w-16 h-16 rounded-xl bg-primary text-white grid place-items-center text-3xl mb-4 shadow-md">👨‍🍳</div>
          <h2 className="font-bold text-2xl text-ink mb-1">Selamat Datang</h2>
          <button className="text-sm underline mb-3" onClick={onCloud}>Login Cloud Owner / Dapur</button>
          <p className="text-sm text-gray-500 mb-4">Masukkan PIN Anda untuk mulai.</p>

          <form className="w-full max-w-[280px]" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div className="h-12 rounded-xl border border-gray-300 bg-gray-50 grid place-items-center tracking-[0.5em] text-xl mb-1">
              {busy ? <span className="text-gray-400 text-sm tracking-normal">Memeriksa PIN…</span>
                : pin ? '•'.repeat(pin.length) : <span className="text-gray-400 text-sm tracking-normal">Masukkan PIN</span>}
            </div>
            {error && <p role="alert" className="text-center text-sm text-primary-bright mb-1">{error}</p>}
            <div className="grid grid-cols-3 gap-2 mt-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '←'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setError('');
                    if (k === 'C') setPin('');
                    else if (k === '←') setPin((p) => p.slice(0, -1));
                    else if (pin.length < 6) setPin((p) => p + k);
                  }}
                  className="h-12 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-primary active:text-white font-semibold text-lg transition-colors"
                >
                  {k}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={busy || pin.length < 4}
              className="w-full mt-4 h-12 rounded-xl bg-primary hover:bg-primary-bright text-white font-semibold disabled:opacity-40 transition-colors shadow-md"
            >
              Login →
            </button>
            {demo && <p className="text-center text-xs text-gray-400 mt-3">PIN awal: kasir 1111 · owner 1234 (wajib diganti saat login pertama)</p>}
          </form>

          <div className="flex items-center gap-4 text-xs text-gray-500 mt-8">
            <span>🏬 Main Branch</span>
            <span>
              Koneksi:{' '}
              <span className={online ? 'text-green-600 font-semibold' : 'text-primary-bright font-semibold'}>
                {online ? 'Online' : 'Offline'}
              </span>
            </span>
          </div>
          <div className="text-center text-[11px] text-gray-400 mt-6">
            Kedai Rakdjat · Sistem Kasir
            <div className="text-primary-bright font-semibold mt-1">Data transaksi tersimpan di perangkat ini</div>
          </div>
        </div>
      </div>
    </div>
  );
}
