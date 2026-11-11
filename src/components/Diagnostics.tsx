import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { cloudProject, deviceId, loadSupabase } from '../supabase';
import { db } from '../db';
import { buildPrinterTest, connectPrinter, printBytes, printerAvailable } from '../printer';
import migration2 from '../../supabase/migrations/0002_secure_sync.sql?raw';
import migration3 from '../../supabase/migrations/0003_inventory_reporting.sql?raw';

import migration4 from '../../supabase/migrations/0004_operations.sql?raw';

function downloadSql(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
export default function Diagnostics() {
  const [results,setResults]=useState<{label:string;ok:boolean;detail:string}[]>([]);
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  async function inspect() {
    setBusy(true);
    const rows=[{label:'Lingkungan aman',ok:window.isSecureContext,detail:window.isSecureContext ? 'HTTPS / localhost aktif' : 'Buka melalui HTTPS untuk fitur perangkat.'}, {label:'Web Bluetooth',ok:printerAvailable(),detail:printerAvailable() ? 'API tersedia; printer fisik belum diuji.' : 'Gunakan browser/perangkat yang mendukung Web Bluetooth.'}, {label:'Kunci transaksi lintas tab',ok:!!navigator.locks,detail:navigator.locks ? 'Web Locks tersedia' : 'Browser belum mendukung Web Locks'}];
    try {
      const sb=await loadSupabase();
      if (!sb) throw new Error('Koneksi Supabase belum dikonfigurasi.');
      const {data:{session}}=await sb.auth.getSession();
      rows.push({label:'Login cloud',ok:!!session,detail:session ? 'Sesi akun cloud tersedia' : 'Login cloud dahulu di atas.'});
      if (session) {
        const schema=await sb.rpc('pos_schema_version');
        rows.push({label:'Migrasi database',ok:!schema.error && schema.data===4,detail:schema.error ? 'Migrasi 0004 belum terverifikasi: '+schema.error.message : `Versi schema: ${schema.data}`});
        const member=await sb.from('cloud_memberships').select('role').eq('device_id',await deviceId());
        rows.push({label:'Akses tablet ini',ok:!member.error && !!member.data?.length,detail:member.error?.message ?? (member.data?.map(m=>m.role).join(', ') || 'Belum ada membership untuk tablet ini.')});
      }
      const settings=await db.settings.toArray();
      const key=settings.find(s=>s.key==='supabase_anon_key')?.value || import.meta.env.VITE_SUPABASE_ANON_KEY;
      const anon=createClient(cloudProject(),key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const check=await anon.from('orders').select('local_id').limit(1);
      rows.push({label:'Akses publik dibatasi',ok:check.error?.code === '42501',detail:check.error ? `Respons akses anonim: ${check.error.code}. Cocokkan juga hasil migrasi.` : 'Endpoint menerima pembacaan anonim. Terapkan migrasi keamanan.'});
    } catch(e) { rows.push({label:'Koneksi cloud',ok:false,detail:(e as Error).message}); }
    setResults(rows); setBusy(false);
  }
  return <section className="panel mb-6"><h2>Pemeriksaan Kesiapan Kedai</h2><p className="text-sm text-gray-500 mb-4">Periksa koneksi dan migrasi, lalu uji printer saat perangkat tersedia. Pemeriksaan ini tidak mengubah data transaksi.</p>
    <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={inspect} className="primary-button">{busy ? 'Memeriksa…' : 'Periksa kesiapan'}</button>
      <button className="secondary-button" onClick={()=>downloadSql(migration2,'0002_secure_sync.sql')}>Unduh SQL keamanan</button><button className="secondary-button" onClick={()=>downloadSql(migration3,'0003_inventory_reporting.sql')}>Unduh SQL stok & laporan</button>
      <button className="secondary-button" onClick={()=>downloadSql(migration4,'0004_operations.sql')}>Unduh SQL operasional</button>
      <button disabled={busy || !printerAvailable()} className="secondary-button" onClick={async()=>{setBusy(true);try{const name=await connectPrinter();await printBytes(buildPrinterTest());setMessage(`Cetak uji dikirim ke ${name}. Periksa kertas dan keterbacaan secara langsung.`);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Hubungkan & cetak uji</button>
    </div><p className="text-xs text-gray-500 mt-3">SQL dijalankan oleh admin di Supabase SQL Editor secara berurutan dan hanya sekali. Tombol unduh tidak menerapkan migrasi.</p>
    {message && <p role="status" className="notice mt-4">{message}</p>}
    <div className="mt-4 space-y-2">{results.map(r=><div key={r.label} className="flex gap-3 border-b py-3 text-sm"><span className={r.ok?'text-green-700':'text-amber-700'}>{r.ok?'✓':'!'}</span><div><strong>{r.label}</strong><p className="text-gray-500 text-xs mt-1">{r.detail}</p></div></div>)}</div>
  </section>;
}
