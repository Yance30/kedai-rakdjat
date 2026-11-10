import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, hashPin } from '../db';
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
    if (!form.name.trim() || !(price > 0)) {
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
    const data = {
      staff: await db.staff.toArray(),
      shifts: await db.shifts.toArray(),
      products: await db.products.toArray(),
      orders: await db.orders.toArray(),
      orderItems: await db.orderItems.toArray(),
      payments: await db.payments.toArray(),
      settings: await db.settings.toArray(),
      tables: await db.meja.toArray(),
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kedai-rakdjat-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg('Backup diunduh.');
  }

  async function importBackup(file: File) {
    const data = JSON.parse(await file.text());
    if (!confirm('Import akan MENGGANTI seluruh data saat ini. Lanjutkan?')) return;
    await db.transaction('rw', [db.staff, db.shifts, db.products, db.orders, db.orderItems, db.payments, db.settings, db.meja], async () => {
      await Promise.all([db.staff, db.shifts, db.products, db.orders, db.orderItems, db.payments, db.settings, db.meja].map((t) => t.clear()));
      await db.staff.bulkAdd(data.staff ?? []);
      await db.shifts.bulkAdd(data.shifts ?? []);
      await db.products.bulkAdd(data.products ?? []);
      await db.orders.bulkAdd(data.orders ?? []);
      await db.orderItems.bulkAdd(data.orderItems ?? []);
      await db.payments.bulkAdd(data.payments ?? []);
      await db.settings.bulkAdd(data.settings ?? []);
      await db.meja.bulkAdd(
        data.tables ?? Array.from({ length: 8 }, (_, i) => ({ name: `T-0${i + 1}`, status: 'available' as const })),
      );
    });
    setMsg('Import berhasil. Data diganti dari backup.');
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
    await db.staff.update(staff.id!, { pinHash: hashPin(pin1) });
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
                    onClick={() => { if (confirm(`Hapus menu "${p.name}"?`)) db.products.delete(p.id!); }}
                    className="text-xs px-2 py-1 rounded-full bg-red-50 text-primary-bright"
                  >
                    Hapus
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
            <div className="flex items-center gap-3">
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