import { useState } from 'react';
import { db } from '../db';
import CloudAccess from '../components/CloudAccess';
import Cloud from './Cloud';
import Kds from './Kds';

export default function CloudPortal({ onBack }: { onBack: () => void }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [revision, setRevision] = useState(0);
  const [screen, setScreen] = useState('dashboard');
  const [msg, setMsg] = useState('');
  return <div className="h-full overflow-y-auto p-4 bg-gray-50">
    <button onClick={onBack} className="underline mb-4">Kembali ke login kasir</button>
    <details className="mb-4 bg-white border rounded p-3"><summary>Konfigurasi koneksi cloud</summary>
      <form className="flex flex-wrap gap-2 mt-3" onSubmit={async e => {
        e.preventDefault();
        try {
          if (new URL(url).protocol !== 'https:') throw new Error('Gunakan URL HTTPS Supabase.');
          await db.settings.bulkPut([{ key: 'supabase_url', value: url.trim() }, { key: 'supabase_anon_key', value: key.trim() }]);
          setRevision(n => n + 1); setMsg('Koneksi disimpan. Login dengan akun yang diberi akses oleh admin.');
        } catch (e) { setMsg((e as Error).message); }
      }}><input required type="url" aria-label="URL Supabase" placeholder="https://….supabase.co" value={url} onChange={e => setUrl(e.target.value)} className="border rounded p-2" />
        <input required aria-label="Publishable key" placeholder="Publishable / anon key" value={key} onChange={e => setKey(e.target.value)} className="border rounded p-2" />
        <button className="bg-primary text-white rounded p-2">Simpan koneksi</button>
      </form>{msg && <p role="status" className="text-sm mt-2">{msg}</p>}
    </details>
    <CloudAccess key={revision} roles={['owner', 'kitchen']}>{(device, role) => <>
      {role === 'owner' && <div className="flex gap-4 p-3"><button onClick={() => setScreen('dashboard')}>Dashboard Owner</button><button onClick={() => setScreen('kds')}>Dapur</button></div>}
      {role === 'kitchen' || screen === 'kds' ? <Kds key={device} device={device} /> : <Cloud key={device} device={device} />}
    </>}</CloudAccess>
  </div>;
}
