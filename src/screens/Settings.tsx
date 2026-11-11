import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { changePin } from '../auth';
import { createBackup, downloadBackup, parseBackup, restoreBackup } from '../backup';
import CloudAccess from '../components/CloudAccess';
import Diagnostics from '../components/Diagnostics';
import { rupiah } from '../money';
import { pushAll } from '../sync';
import type { Staff } from '../types';

function readImage(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

interface Form {
  id?: number;
  name: string;
  category: string;
  price: string;
  photo?: string;
  active: 1 | 0;
}

const emptyForm: Form = { name: '', category: 'Food', price: '', active: 1 };

export default function Settings({ staff }: { staff: Staff }) {
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.toArray(), []) ?? [];
  const get = (k: string) => settings.find((s) => s.key === k)?.value ?? '';
  const put = (k: string, v: string) => db.settings.put({ key: k, value: v });
  const isOwner = staff.role === 'owner';

  const [form, setForm] = useState<Form>(emptyForm);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [msg, setMsg] = useState('');
  const [syncing, setSyncing] = useState(false);

  async function syncNow() {
    setSyncing(true);
    const r = await pushAll();
    setSyncing(false);
    setMsg(r.msg);
  }

  async function saveProduct() {
    const price = Number(form.price);
    if (!form.name.trim() || (!Number.isSafeInteger(price) || price <= 0)) {
      setMsg('Nama menu dan harga (> 0) wajib diisi.');
      return;
    }
    const data = {
      name: form.name.trim(),
      category: form.category.trim() || 'Lainnya',
      price,
      active: form.active,
      photo: form.photo,
    };
    if (form.id) await db.products.update(form.id, data);
    else await db.products.add(data);
    setForm(emptyForm);
    setMsg('Menu tersimpan.');
  }

  async function exportBackup() {
    try { downloadBackup(await createBackup()); await db.settings.put({key:'last_backup_download',value:String(Date.now())}); setMsg('Backup diunduh. Simpan di tempat aman karena memuat data usaha dan hash PIN.'); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function importBackup(file: File) {
    try {
      if (file.size > 30_000_000) throw new Error('File melebihi 30 MB.');
      const backup = parseBackup(await file.text());
      if (!confirm('File valid: ' + backup.data.orders.length + ' pesanan. Data akan diganti dan salinan pemulihan disimpan. Lanjutkan?')) return;
      await restoreBackup(backup);
      window.location.reload();
    } catch (e) { setMsg((e as Error).message); }
  }

  async function savePin() {
    if (!/^\d{4,6}$/.test(pin1)) {
      setMsg('PIN baru harus 4-6 angka.');
      return;
    }
    if (pin1 !== pin2) {
      setMsg('Konfirmasi PIN tidak sama.');
      return;
    }
    try { await changePin(staff.id!, pin1); } catch (e) { setMsg((e as Error).message); return; }
    setPin1('');
    setPin2('');
    setMsg('PIN berhasil diganti.');
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="font-bold text-xl mb-6">Pengaturan</h1>
      {msg && <p className="mb-4 text-sm text-primary-bright">{msg}</p>}

      {isOwner && (
        <>
          <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="font-semibold mb-4">Manajemen Menu</h2>
            <div className="grid md:grid-cols-2 gap-3 mb-4">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nama menu"
                className="h-11 rounded-lg border border-gray-300 px-3"
              />
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Kategori (Food/Drink/...)"
                className="h-11 rounded-lg border border-gray-300 px-3"
              />
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="Harga (Rp)"
                className="h-11 rounded-lg border border-gray-300 px-3"
              />
              <label className="h-11 rounded-lg border border-gray-300 px-3 flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setForm({ ...form, photo: await readImage(f) });
                  }}
                />
              </label>
            </div>
            {form.photo && <img src={form.photo} alt="preview" className="h-16 w-16 object-cover rounded-lg mb-3" />}
            <div className="flex gap-2">
              <button onClick={saveProduct} className="h-11 px-6 rounded-lg bg-primary text-white font-semibold">
                {form.id ? 'Simpan Perubahan' : 'Tambah Menu'}
              </button>
              {form.id && (
                <button onClick={() => setForm(emptyForm)} className="h-11 px-4 rounded-lg bg-gray-100">
                  Batal
                </button>
              )}
            </div>
            <div className="mt-6 space-y-2">
              {products.map((p) => (
                <div key={p.id} className="flex items-center gap-3 border-b border-gray-100 pb-2">
                  {p.photo ? (
                    <img src={p.photo} alt={p.name} className="h-10 w-10 object-cover rounded-lg" />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary grid place-items-center text-xs font-bold">
                      {p.name.slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.category} · {rupiah(p.price)}</div>
                  </div>
                  <button
                    onClick={() => db.products.update(p.id!, { active: p.active === 1 ? 0 : 1 })}
                    className={`text-xs px-2 py-1 rounded-full ${p.active === 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {p.active === 1 ? 'Aktif' : 'Nonaktif'}
                  </button>
                  <button
                    onClick={() => setForm({ id: p.id, name: p.name, category: p.category, price: String(p.price), photo: p.photo, active: p.active })}
                    className="text-xs px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => { if (confirm(`Nonaktifkan menu "${p.name}"?`)) db.products.update(p.id!, { active: 0 }); }}
                    className="text-xs px-2 py-1 rounded-full bg-red-50 text-primary-bright"
                  >
                    Arsipkan
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="font-semibold mb-2">Foto QRIS Kedai</h2>
            <p className="text-xs text-gray-500 mb-4">Foto ini ditampilkan di layar pembayaran QRIS.</p>
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await put('qris_image', await readImage(f));
              }}
            />
            {get('qris_image') && (
              <img src={get('qris_image')} alt="QRIS kedai" className="h-40 w-40 object-contain mt-4 border border-gray-200 rounded-lg" />
            )}
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="font-semibold mb-2">Service Charge</h2>
            <div className="flex gap-2">
              {['0', '5'].map((v) => (
                <button
                  key={v}
                  onClick={() => put('service_charge', v)}
                  className={`px-4 py-2 rounded-lg font-medium ${get('service_charge') === v || (v === '0' && !get('service_charge')) ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
                >
                  {v === '0' ? 'Tidak ada' : '5%'}
                </button>
              ))}
            </div>
          </section>
          <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="font-semibold mb-2">Backup Data</h2>
            <button className="text-sm underline mb-3" onClick={async () => { const saved = await db.recovery.orderBy('id').last(); if (saved) downloadBackup(JSON.parse(saved.data), 'sebelum-restore'); else setMsg('Belum ada salinan sebelum restore.'); }}>Unduh salinan sebelum restore terakhir</button>
            <p className="text-xs text-gray-500 mb-4">Export cadangan seluruh data, atau import untuk memulihkan.</p>
            <div className="flex gap-2 items-center">
              <button onClick={exportBackup} className="h-11 px-6 rounded-lg bg-primary text-white font-semibold">
                Export Backup
              </button>
              <label className="h-11 px-4 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center cursor-pointer text-sm font-medium">
                Import Backup
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importBackup(f);
                  }}
                />
              </label>
            </div>
          </section>
          <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="font-semibold mb-2">Koneksi Cloud (Supabase)</h2>
            {get('sync_paused') === 'true' && <div className="p-3 bg-amber-50 mb-3"><p>Sync dijeda setelah restore. Periksa data sebelum mengirim perubahan ke cloud.</p><button className="underline" onClick={async () => { if (confirm('Kirim hasil restore ke cloud? Data cloud perangkat ini akan mengikuti data tablet.')) { await put('sync_paused', 'false'); await syncNow(); } }}>Aktifkan kembali sync</button></div>}
            {get('sync_error') && <p role="alert" className="text-sm mb-3">{get('sync_error')}</p>}
            <p className="text-xs text-gray-500 mb-4">
              Tablet tetap jalan offline. Isi URL & anon key proyek Supabase untuk mengaktifkan sync, Dashboard Owner, dan KDS dapur.
            </p>
            <div className="space-y-3 mb-4 max-w-xl">
              <input
                value={get('supabase_url')}
                onChange={(e) => put('supabase_url', e.target.value.trim())}
                placeholder="https://xxxx.supabase.co"
                className="w-full h-11 rounded-lg border border-gray-300 px-3"
              />
              <input
                value={get('supabase_anon_key')}
                onChange={(e) => put('supabase_anon_key', e.target.value.trim())}
                placeholder="anon public key"
                className="w-full h-11 rounded-lg border border-gray-300 px-3"
              />
            </div>
            <CloudAccess />
            <div className="flex items-center gap-3 mt-3">
              <button onClick={syncNow} disabled={syncing} className="h-11 px-6 rounded-lg bg-primary text-white font-semibold disabled:opacity-40">
                {syncing ? 'Sync…' : 'Sync Sekarang'}
              </button>
              <span className="text-xs text-gray-500">
                {get('last_sync') ? `Sync terakhir: ${new Date(Number(get('last_sync'))).toLocaleString('id-ID')}` : 'Belum pernah sync.'}
              </span>
            </div>
          </section>
        </>
      )}

      {isOwner && <Diagnostics />}
      {!isOwner && <section className="mb-6"><CloudAccess roles={['cashier']} /></section>}
      <section className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl">
        <h2 className="font-semibold mb-4">Ganti PIN Saya ({staff.name})</h2>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <input
            type="password"
            value={pin1}
            onChange={(e) => setPin1(e.target.value)}
            placeholder="PIN baru (4-6 angka)"
            className="h-11 rounded-lg border border-gray-300 px-3"
          />
          <input
            type="password"
            value={pin2}
            onChange={(e) => setPin2(e.target.value)}
            placeholder="Ulangi PIN baru"
            className="h-11 rounded-lg border border-gray-300 px-3"
          />
        </div>
        <button onClick={savePin} className="h-11 px-6 rounded-lg bg-primary text-white font-semibold">
          Simpan PIN
        </button>
      </section>
    </div>
  );
}
