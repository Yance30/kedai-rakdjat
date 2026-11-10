import { useEffect, useState } from 'react';
import { db, hashPin } from '../db';
import type { Staff } from '../types';

export default function Login({ onLogin }: { onLogin: (s: Staff) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [intro, setIntro] = useState(true);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

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
    const s = await db.staff.where('pinHash').equals(hashPin(pin)).first();
    if (s) onLogin(s);
    else {
      setError('PIN salah.');
      setPin('');
    }
  }

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
          <img src="/login-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-black/25" />
          <div className="absolute inset-0 grid place-items-center p-8">
            <div className="kr-fade-up bg-white/95 backdrop-blur rounded-2xl shadow-2xl p-8 max-w-sm text-center" style={{ animationDelay: '0.35s' }}>
              <h1 className="text-primary font-bold text-3xl mb-3">Kedai Rakdjat</h1>
              <p className="text-gray-600 text-sm leading-relaxed mb-6">
                Empowering culinary heritage with modern precision. The ultimate POS solution for premium service environments.
              </p>
              <div className="flex justify-center gap-6 text-[11px] text-gray-500 font-semibold tracking-wide">
                <span>⚡ FAST TRANSACTIONS</span>
                <span>🛡️ SECURE ACCESS</span>
              </div>
            </div>
          </div>
        </div>

        <div className="kr-slide-right w-full md:w-[420px] shrink-0 bg-white flex flex-col items-center justify-center p-8 overflow-y-auto">
          <div className="w-16 h-16 rounded-xl bg-primary text-white grid place-items-center text-3xl mb-4 shadow-md">👨‍🍳</div>
          <h2 className="font-bold text-2xl text-ink mb-1">Welcome Back</h2>
          <p className="text-sm text-gray-500 mb-6">Sign in to manage your branch</p>

          <div className="w-full max-w-[280px]">
            <div className="h-12 rounded-xl border border-gray-300 bg-gray-50 grid place-items-center tracking-[0.5em] text-xl mb-1">
              {pin ? '•'.repeat(pin.length) : <span className="text-gray-400 text-sm tracking-normal">Masukkan PIN</span>}
            </div>
            {error && <p className="text-center text-sm text-primary-bright mb-1">{error}</p>}
            <div className="grid grid-cols-3 gap-2 mt-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '←'].map((k) => (
                <button
                  key={k}
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
              onClick={submit}
              disabled={pin.length < 4}
              className="w-full mt-4 h-12 rounded-xl bg-primary hover:bg-primary-bright text-white font-semibold disabled:opacity-40 transition-colors shadow-md"
            >
              Login →
            </button>
            <p className="text-center text-xs text-gray-400 mt-3">PIN demo: kasir 1111 · owner 1234</p>
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-500 mt-8">
            <span>🏬 Main Branch</span>
            <span>
              System Status:{' '}
              <span className={online ? 'text-green-600 font-semibold' : 'text-primary-bright font-semibold'}>
                {online ? 'Online' : 'Offline'}
              </span>
            </span>
          </div>
          <div className="text-center text-[11px] text-gray-400 mt-6">
            © 2024 Kedai Rakdjat Enterprise. All Rights Reserved.
            <div className="text-primary-bright font-semibold mt-1">v2.4.0</div>
          </div>
        </div>
      </div>
    </div>
  );
}