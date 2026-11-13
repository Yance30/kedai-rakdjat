import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addStaff, resetStaffPin, updateStaff } from '../auth';
import { db } from '../db';
import type { Role, Staff } from '../types';

/** Owner-only: who may log in on this tablet. Staff are deactivated, never deleted, so shift history keeps its names. */
export default function StaffManager({ actor }: { actor: Staff }) {
  const people = useLiveQuery(async () => (await db.staff.toArray()).map(({ id, name, role, active, mustChangePin }) => ({ id: id!, name, role, active: active !== false, mustChangePin: !!mustChangePin })), []) ?? [];
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('kasir');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(true); setMsg('');
    try { await action(); setMsg(done); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h2 className="font-semibold mb-1">Staf & Akses Login</h2>
      <p className="text-xs text-gray-500 mb-4">
        Tambahkan setiap orang yang boleh memakai tablet ini. Login cukup dengan PIN, jadi setiap PIN harus berbeda.
        PIN yang Anda buat di sini bersifat sementara: staf wajib menggantinya dengan PIN pribadi saat login pertama.
        Staf yang sudah tidak bertugas cukup dinonaktifkan; riwayat shift mereka tetap tersimpan.
      </p>
      {msg && <p role="status" className="text-sm text-primary-bright mb-3">{msg}</p>}

      <form className="grid sm:grid-cols-4 gap-2 mb-5" onSubmit={(e) => { e.preventDefault(); void run(async () => { await addStaff({ name, role, pin }, actor.id!); setName(''); setPin(''); }, 'Staf ditambahkan. Berikan PIN sementara kepada staf tersebut.'); }}>
        <input aria-label="Nama staf" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama staf" className="h-11 rounded-lg border border-gray-300 px-3 sm:col-span-2" />
        <select aria-label="Peran staf" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-11 rounded-lg border border-gray-300 px-3">
          <option value="kasir">Kasir</option>
          <option value="owner">Owner</option>
        </select>
        <input aria-label="PIN sementara" required type="password" inputMode="numeric" pattern="\d{4,6}" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN sementara (4–6 angka)" className="h-11 rounded-lg border border-gray-300 px-3" />
        <button disabled={busy} className="h-11 px-6 rounded-lg bg-primary text-white font-semibold sm:col-span-4 sm:justify-self-start disabled:opacity-40">
          {busy ? 'Memproses…' : 'Tambah Staf'}
        </button>
      </form>

      <ul className="divide-y">
        {people.map((p) => (
          <li key={p.id} className={`py-3 flex flex-wrap items-center gap-2 ${p.active ? '' : 'opacity-60'}`}>
            <div className="flex-1 min-w-[160px]">
              <div className="font-medium text-sm">{p.name}{p.id === actor.id && <span className="text-gray-400"> (Anda)</span>}</div>
              <div className="text-xs text-gray-500">
                {p.role === 'owner' ? 'Owner' : 'Kasir'} · {p.active ? 'Aktif' : 'Nonaktif'}{p.mustChangePin && p.active ? ' · menunggu ganti PIN' : ''}
              </div>
            </div>
            <button disabled={busy} className="text-xs px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200" onClick={() => {
              const next = prompt('Nama baru', p.name);
              if (next && next.trim() !== p.name) void run(() => updateStaff(p.id, { name: next }, actor.id!), 'Nama staf diperbarui.');
            }}>Ubah nama</button>
            <button disabled={busy} className="text-xs px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200" onClick={() => {
              const next = prompt(`PIN sementara baru untuk ${p.name} (4–6 angka). ${p.name} wajib menggantinya saat login.`);
              if (next) void run(() => resetStaffPin(p.id, next.trim(), actor.id!), `PIN ${p.name} direset. Berikan PIN sementara kepadanya.`);
            }}>Reset PIN</button>
            {p.id !== actor.id && (
              <button disabled={busy} className={`text-xs px-3 py-1.5 rounded-full ${p.active ? 'bg-red-50 text-primary-bright' : 'bg-green-100 text-green-700'}`} onClick={() => {
                if (p.active && !confirm(`Nonaktifkan ${p.name}? Ia tidak bisa login lagi sampai diaktifkan kembali.`)) return;
                void run(() => updateStaff(p.id, { active: !p.active }, actor.id!), p.active ? `${p.name} dinonaktifkan.` : `${p.name} diaktifkan kembali.`);
              }}>{p.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
