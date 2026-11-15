import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { saveTable } from '../operations';
import type { Staff } from '../types';
import { askText } from './Dialog';

const STATUS_LABEL = { available: 'Kosong', occupied: 'Terisi', cleaning: 'Bersih-bersih' } as const;

/** Owner-only: add and rename dining tables shown on Denah Meja. */
export default function TableManager({ actor }: { actor: Staff }) {
  const tables = useLiveQuery(() => db.meja.orderBy('id').toArray(), []) ?? [];
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(true); setMsg('');
    try { await action(); setMsg(done); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h2 className="font-semibold mb-1">Meja</h2>
      <p className="text-xs text-gray-500 mb-4">
        Tambah atau ganti nama meja di Denah Meja. Meja tidak bisa dihapus agar riwayat pesanan dan data cloud tetap cocok.
      </p>
      {msg && <p role="status" className="kr-fade-up text-sm text-primary-bright mb-3">{msg}</p>}
      <form className="flex gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { await saveTable({ name }, actor.id!); setName(''); }, 'Meja ditambahkan.'); }}>
        <input aria-label="Nama meja baru" required maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama meja, mis. T-09 atau Teras 1" className="flex-1 h-11 rounded-lg border border-gray-300 px-3" />
        <button disabled={busy || !name.trim()} className="h-11 px-5 rounded-lg bg-primary text-white font-semibold disabled:opacity-40">Tambah Meja</button>
      </form>
      <ul className="kr-stagger grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tables.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2">
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{t.name}</div>
              <div className="text-[11px] text-gray-500">{STATUS_LABEL[t.status]}</div>
            </div>
            <button
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 shrink-0"
              aria-label={`Ganti nama meja ${t.name}`}
              onClick={async () => {
                const next = await askText('Nama baru meja (maks. 20 karakter)', { title: `Ganti nama ${t.name}`, initial: t.name, confirmLabel: 'Simpan' });
                if (next && next.trim() !== t.name) void run(() => saveTable({ id: t.id, name: next }, actor.id!), 'Nama meja diperbarui.');
              }}
            >
              Ubah
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
