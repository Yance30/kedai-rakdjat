import { useEffect, useState, type ReactNode } from 'react';
import { deviceId, loadSupabase } from '../supabase';
import { pushAll } from '../sync';

type Membership = { device_id: string; role: 'owner' | 'cashier' | 'kitchen' };
export default function CloudAccess({ children, roles = ['owner', 'cashier', 'kitchen'] }: {
  children?: (device: string, role: Membership['role']) => ReactNode;
  roles?: Membership['role'][];
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState('');
  const [members, setMembers] = useState<Membership[]>([]);
  const [device, setDevice] = useState('');
  const [local, setLocal] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      setLocal(await deviceId());
      const sb = await loadSupabase();
      if (!sb) { setUser(''); setMembers([]); setMsg('Isi koneksi Supabase terlebih dahulu.'); return; }
      const { data: { session } } = await sb.auth.getSession();
      setUser(session?.user.email ?? '');
      if (!session) { setMembers([]); return; }
      const { data, error } = await sb.from('cloud_memberships').select('device_id,role');
      if (error) throw error;
      const rows = (data ?? []) as Membership[];
      setMembers(rows);
      setDevice(old => rows.some(m => m.device_id === old) ? old : rows[0]?.device_id ?? '');
      setMsg(rows.length ? '' : 'Akun belum diberi akses perangkat. Hubungi owner/admin.');
    } catch (e) { setMembers([]); setMsg((e as Error).message); }
  }
  useEffect(() => {
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    void refresh();
    void loadSupabase().then(sb => {
      if (stopped || !sb) return;
      const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
        if (!session) { setUser(''); setMembers([]); }
        else { setTimeout(() => { if (!stopped) void refresh(); }, 0); }
      });
      unsubscribe = () => subscription.unsubscribe();
    }).catch(e => setMsg((e as Error).message));
    return () => { stopped = true; unsubscribe?.(); };
  }, []);
  async function login() {
    setBusy(true);
    try {
      const sb = await loadSupabase();
      if (!sb) throw new Error('Koneksi Supabase belum diisi.');
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setPassword('');
      await refresh();
      void pushAll();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  const membership = members.find(m => m.device_id === device && roles.includes(m.role));
  return <div className="h-full overflow-y-auto">
    <section className="p-4 bg-white border rounded-xl space-y-3">
      <h2 className="font-semibold">Akun Cloud</h2>
      <p className="text-xs text-gray-500 break-all">ID tablet ini: {local}</p>
      {user ? <>
        <p className="text-sm">{user}</p>
        <select aria-label="Perangkat cloud" value={device} onChange={e => setDevice(e.target.value)} className="border rounded p-2 max-w-full">
          {members.map(m => <option key={m.device_id} value={m.device_id}>{m.device_id} · {m.role}</option>)}
        </select>
        <button className="ml-3 text-primary" onClick={async () => { const sb = await loadSupabase(); const result = await sb?.auth.signOut({ scope: 'local' }); if (result?.error) { setMsg(result.error.message); return; } setUser(''); setMembers([]); }}>Keluar akun cloud</button>
        {!membership && <p className="text-sm">Akun ini tidak memiliki hak akses untuk layar ini.</p>}
      </> : <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void login(); }}>
        <input aria-label="Email cloud" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email cloud" className="border rounded p-2" />
        <input aria-label="Password cloud" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Password cloud" className="border rounded p-2" />
        <button disabled={busy} className="rounded bg-primary text-white px-4 py-2">{busy ? 'Memeriksa…' : 'Login Cloud'}</button>
      </form>}
      {msg && <p role="alert" className="text-sm text-primary">{msg}</p>}
      <button className="text-xs underline" onClick={refresh}>Periksa koneksi dan akses</button>
    </section>
    {membership && children?.(device, membership.role)}
  </div>;
}
