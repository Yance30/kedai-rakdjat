import { useEffect, useRef, useState } from 'react';

// In-app replacement for window.confirm / window.prompt: those look out of place on the tablet,
// block the UI thread, and can be suppressed in standalone PWA mode on some Android builds.

interface Request {
  kind: 'confirm' | 'prompt';
  message: string;
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
  initial?: string;
  inputMode?: 'text' | 'numeric';
  secret?: boolean;
  resolve: (value: string | null) => void;
}

let show: ((r: Request) => void) | null = null;

interface Options { title?: string; confirmLabel?: string; danger?: boolean }

/** Resolves true when the user confirms, false when cancelled. */
export function askConfirm(message: string, opts: Options = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) { resolve(window.confirm(message)); return; }
    show({ kind: 'confirm', message, ...opts, resolve: (v) => resolve(v !== null) });
  });
}

/** Resolves with the entered text, or null when cancelled. */
export function askText(message: string, opts: Options & { initial?: string; inputMode?: 'text' | 'numeric'; secret?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!show) { resolve(window.prompt(message, opts.initial)); return; }
    show({ kind: 'prompt', message, ...opts, resolve });
  });
}

export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const okButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    show = (r) => { setValue(r.initial ?? ''); setReq(r); };
    return () => { show = null; };
  }, []);

  useEffect(() => {
    if (!req) return;
    (req.kind === 'prompt' ? input.current : okButton.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function close(result: string | null) {
    req?.resolve(result);
    setReq(null);
  }

  if (!req) return null;
  return (
    <div className="kr-backdrop fixed inset-0 z-[80] bg-maroon-deep/50 backdrop-blur-sm grid place-items-center p-4" onClick={() => close(null)}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={req.title ?? 'Konfirmasi'}
        className="kr-modal w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); close(req.kind === 'prompt' ? value : 'ok'); }}
      >
        <h2 className="font-display font-bold text-lg mb-2">{req.title ?? (req.kind === 'prompt' ? 'Masukkan data' : 'Konfirmasi')}</h2>
        <p className="text-sm text-gray-600 whitespace-pre-line mb-4">{req.message}</p>
        {req.kind === 'prompt' && (
          <input
            ref={input}
            aria-label={req.message}
            className="w-full h-12 rounded-xl border border-gray-300 px-4 mb-4"
            type={req.secret ? 'password' : 'text'}
            inputMode={req.inputMode}
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => close(null)} className="flex-1 h-11 rounded-xl border border-gray-300 bg-white text-gray-700 font-semibold">Batal</button>
          <button
            ref={okButton}
            type="submit"
            disabled={req.kind === 'prompt' && !value.trim()}
            className={`flex-1 h-11 rounded-xl text-white font-semibold ${req.danger ? 'bg-primary-bright' : 'bg-primary'}`}
          >
            {req.confirmLabel ?? 'Ya, lanjutkan'}
          </button>
        </div>
      </form>
    </div>
  );
}
