import { useState } from 'react';
import { applyCloudRestore, previewCloudRestore, type CloudPreview } from '../cloud-restore';
import { deviceId, loadSupabase } from '../supabase';

const when = (t: number) => t ? new Date(t).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB' : 'belum ada transaksi';

export default function CloudRestore({ device, role }: { device: string; role: string }) {
  const [preview, setPreview] = useState<CloudPreview | null>(null);
  const [local, setLocal] = useState('');
  const [pins, setPins] = useState<Record<number, string>>({});
  const [retired, setRetired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (role !== 'owner') return <p className="text-xs text-gray-500 mt-3">Pemulihan dari cloud hanya tersedia untuk akun cloud owner.</p>;

  async function inspect() {
    setBusy(true); setMsg(''); setPreview(null);
    try {
      const sb = await loadSupabase();
      if (!sb) throw new Error('Koneksi Supabase belum diisi.');
      setLocal(await deviceId());
      setPreview(await previewCloudRestore(sb, device));
      setPins({}); setRetired(false);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (!preview) return;
    if (!confirm(`Ganti seluruh data tablet ini dengan data cloud ${preview.device} (${preview.orders} pesanan)? Salinan data tablet saat ini disimpan dulu.`)) return;
    setBusy(true); setMsg('Membuat PIN baru dan memulihkan data… (beberapa detik per staf)');
    try {
      await applyCloudRestore(preview, pins);
      window.location.reload();
    } catch (e) { setMsg((e as Error).message); setBusy(false); }
  }

  return (
    <section className="mt-4 p-4 border rounded-xl bg-white">
      <h3 className="font-semibold mb-1">Pulihkan dari Cloud</h3>
      <p className="text-xs text-gray-500 mb-3">Untuk tablet pengganti atau tablet yang datanya hilang: tarik kembali data perangkat <strong className="break-all">{device}</strong> dari cloud. PIN dan pengaturan tablet (service charge, foto QRIS) tidak disimpan di cloud, jadi PIN baru dibuat di sini dan pengaturan perlu diisi ulang.</p>
      <button disabled={busy} onClick={inspect} className="secondary-button">{busy && !preview ? 'Membaca cloud…' : 'Periksa data cloud'}</button>
      {preview && <div className="mt-4 space-y-3 text-sm">
        <p>{preview.staff.length} staf · {preview.orders} pesanan · aktivitas terakhir {when(preview.lastActivity)}.</p>
        {local === preview.device
          ? <p className="notice">Ini perangkat cloud milik tablet ini sendiri. Transaksi yang belum tersinkron akan diganti dengan data cloud (salinan tetap disimpan).</p>
          : <p className="notice">Tablet ini akan melanjutkan sebagai perangkat {preview.device}. Tablet lama dengan ID tersebut tidak boleh dipakai lagi, karena keduanya akan saling menimpa data cloud.</p>}
        <fieldset className="space-y-2">
          <legend className="font-medium mb-1">PIN baru (4–6 angka, berbeda tiap staf; wajib diganti saat login pertama)</legend>
          {preview.staff.map(s => <label key={s.id} className="flex items-center gap-3">
            <span className="w-40 truncate">{s.name} <span className="text-gray-500">· {s.role}</span></span>
            <input aria-label={`PIN baru ${s.name}`} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pins[s.id!] ?? ''} onChange={e => setPins({ ...pins, [s.id!]: e.target.value.replace(/\D/g, '') })} className="border rounded p-2 w-32" />
          </label>)}
        </fieldset>
        <label className="flex items-center gap-2"><input type="checkbox" checked={retired} onChange={e => setRetired(e.target.checked)} />Tablet lama sudah tidak dipakai untuk transaksi</label>
        <button disabled={busy || !retired} onClick={restore} className="primary-button">{busy ? 'Memulihkan…' : 'Pulihkan data dari cloud'}</button>
        <p className="text-xs text-gray-500">Setelah pulih, sync dijeda. Periksa data, isi ulang service charge dan foto QRIS, lalu aktifkan kembali sync.</p>
      </div>}
      {msg && <p role="status" className="text-sm mt-3">{msg}</p>}
    </section>
  );
}
