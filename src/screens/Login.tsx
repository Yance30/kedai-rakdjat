import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { authenticatePin, changePin } from '../auth';
import { db } from '../db';
import { haptic } from '../feedback';
import type { Staff } from '../types';
import Splash from '../components/Splash';

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
    } catch (e) { haptic([60, 40, 60]); setError((e as Error).message); setPin(''); }
    finally { setBusy(false); }
  }
  if (pending) return <div className="h-full grid place-items-center p-6 kr-shell"><form className="kr-modal w-full max-w-sm space-y-4 bg-white rounded-3xl p-7 shadow-2xl" onSubmit={async e => {
    e.preventDefault(); if (busy) return; setBusy(true);
    try {
      if (newPin !== confirmPin) throw new Error('Konfirmasi PIN tidak sama.');
      await changePin(pending.id!, newPin);
      onLogin({ ...pending, mustChangePin: false });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}><p className="eyebrow">KEAMANAN AKUN</p><h1 className="text-xl font-bold text-primary">Buat PIN pribadi terlebih dahulu</h1><p className="text-sm text-gray-600">{pending.name}, PIN ini sementara. Buat PIN baru yang hanya Anda ketahui; PIN ini dipakai untuk login berikutnya.</p>
    <input aria-label="PIN baru" className="border border-gray-300 rounded-xl p-3 w-full" type="password" inputMode="numeric" placeholder="PIN baru (4–6 angka)" value={newPin} onChange={e => setNewPin(e.target.value)} />
    <input aria-label="Ulangi PIN" className="border border-gray-300 rounded-xl p-3 w-full" type="password" inputMode="numeric" placeholder="Ulangi PIN" value={confirmPin} onChange={e => setConfirmPin(e.target.value)} />
    {error && <p key={error} role="alert" className="kr-shake text-sm text-primary-bright">{error}</p>}<button disabled={busy} className="w-full h-12 bg-primary hover:bg-primary-bright text-white font-semibold rounded-xl shadow-md">Simpan PIN & masuk</button>
  </form></div>;

  return (
    <div className="h-full relative overflow-hidden bg-white">
      {intro && <Splash className="kr-intro absolute inset-0 z-50" />}

      {/* The photo fills the screen; the PIN card sits in the middle on every screen size. */}
      <img src={`${import.meta.env.BASE_URL}login-bg.png`} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/25 to-black/40" />
      <div className="relative h-full overflow-y-auto">
        <div className="min-h-full grid place-items-center p-4 sm:p-8">
        <div className="kr-zoom w-full max-w-[380px] bg-white rounded-2xl shadow-2xl px-6 py-8 sm:px-8 flex flex-col items-center">
          <div className="w-16 h-16 rounded-xl bg-primary text-white grid place-items-center text-3xl mb-3 shadow-md">👨‍🍳</div>
          <h1 className="font-display text-primary font-bold text-3xl mb-1">Kedai Rakdjat</h1>
          <h2 className="font-semibold text-lg text-ink">Selamat Datang</h2>
          <p className="text-sm text-gray-500 mb-1">Masukkan PIN Anda untuk mulai.</p>
          <button className="text-sm underline mb-4" onClick={onCloud}>Login Cloud Owner</button>

          <form className="w-full max-w-[280px]" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div key={error || 'pin'} className={`h-12 rounded-xl border bg-gray-50 grid place-items-center mb-1 transition-colors ${error ? 'kr-shake border-primary-bright/60' : 'border-gray-300'}`}>
              {busy ? <span className="kr-breathe text-gray-400 text-sm">Memeriksa PIN…</span>
                : pin ? (
                  <span className="flex gap-3" aria-label={`${pin.length} digit dimasukkan`}>
                    {Array.from(pin).map((_, i) => <span key={i} className="kr-zoom w-3 h-3 rounded-full bg-primary" />)}
                  </span>
                ) : <span className="text-gray-400 text-sm">Masukkan PIN</span>}
            </div>
            {error && <p role="alert" className="kr-fade-up text-center text-sm text-primary-bright mb-1">{error}</p>}
            <div className="kr-stagger grid grid-cols-3 gap-2 mt-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '←'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setError('');
                    haptic(8);
                    if (k === 'C') setPin('');
                    else if (k === '←') setPin((p) => p.slice(0, -1));
                    else if (pin.length < 6) setPin((p) => p + k);
                  }}
                  className="h-12 rounded-xl bg-gray-100 border border-gray-200 hover:bg-gray-200 active:bg-primary active:text-white font-semibold text-lg transition-colors"
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

          <div className="flex items-center gap-4 text-xs text-gray-500 mt-6">
            <span>🏬 Main Branch</span>
            <span>
              Koneksi:{' '}
              <span className={online ? 'text-green-600 font-semibold' : 'text-primary-bright font-semibold'}>
                {online ? 'Online' : 'Offline'}
              </span>
            </span>
          </div>
          <div className="text-center text-[11px] text-primary-bright font-semibold mt-3">Data transaksi tersimpan di perangkat ini</div>
        </div>
        </div>
      </div>
    </div>
  );
}
