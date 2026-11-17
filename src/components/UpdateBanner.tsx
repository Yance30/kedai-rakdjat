import { useState } from 'react';
import { applyUpdate, useUpdateReady } from '../update';

/** Small banner at the top of every screen once a new version has been downloaded. */
export default function UpdateBanner() {
  const ready = useUpdateReady();
  const [busy, setBusy] = useState(false);
  if (!ready) return null;
  return (
    <div role="status" className="kr-fade-up fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-24px)] max-w-md bg-maroon text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-semibold">Versi baru tersedia</div>
        <div className="text-white/70 text-xs">Ketuk saat tidak sedang melayani. Keranjang tetap tersimpan.</div>
      </div>
      <button disabled={busy} onClick={() => { setBusy(true); applyUpdate(); }} className="shrink-0 h-10 px-4 rounded-lg bg-brass text-maroon font-semibold text-sm disabled:opacity-60">
        {busy ? 'Memuat…' : 'Muat ulang'}
      </button>
    </div>
  );
}
