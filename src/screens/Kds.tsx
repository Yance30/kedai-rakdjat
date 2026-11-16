import { useCallback, useEffect, useRef, useState } from 'react';
import { chime, haptic, unlockAudio } from '../feedback';
import { loadSupabase } from '../supabase';

const SOUND_KEY = 'kds_sound';
function readSoundPref() { try { return localStorage.getItem(SOUND_KEY) === 'on'; } catch { return false; } }

interface KdsOrder {
  device_id: string;
  local_id: number;
  created_at: number;
  table_local_id: number | null;
  order_type?: 'dine_in' | 'takeaway';
  kds_status: string;
  /** Paid part of a split bill: its items belong to the parent's kitchen ticket. */
  split_from_local_id?: number | null;
}
interface KdsItem {
  order_local_id: number;
  name: string;
  qty: number;
}

const COLS: { key: string; label: string; next?: string; cls: string }[] = [
  { key: 'incoming', label: 'Masuk', next: 'cooking', cls: 'border-amber-300 bg-amber-50' },
  { key: 'cooking', label: 'Dimasak', next: 'ready', cls: 'border-primary/40 bg-primary/5' },
  { key: 'ready', label: 'Siap Saji', cls: 'border-green-300 bg-green-50' },
];

function elapsed(t: number, now: number) {
  const m = Math.floor((now - t) / 60000);
  return m < 1 ? '<1 mnt' : `${m} mnt`;
}

export default function Kds({ device }: { device: string }) {
  const [configured, setConfigured] = useState(true);
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [items, setItems] = useState<KdsItem[]>([]);
  const [tables, setTables] = useState<{ local_id: number; name: string }[]>([]);
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState('');
  const [sound, setSound] = useState(false);
  const wantSound = useRef(readSoundPref());
  // Ticket keys already shown; null until the first load so opening the screen does not ring.
  const seen = useRef<Set<string> | null>(null);

  async function toggleSound() {
    const next = !sound;
    const ok = next ? await unlockAudio() : true;
    setSound(next && ok);
    wantSound.current = next && ok;
    try { localStorage.setItem(SOUND_KEY, next && ok ? 'on' : 'off'); } catch { /* private mode */ }
    if (next && ok) chime();
  }

  const refresh = useCallback(async () => {
    const sb = await loadSupabase();
    if (!sb) {
      setConfigured(false);
      return;
    }
    setConfigured(true);
    const [o, t] = await Promise.all([
      sb.from('orders').select('*').eq('device_id', device).neq('status', 'void').gte('created_at', new Date().setHours(0, 0, 0, 0)).order('created_at', { ascending: true }),
      sb.from('dining_tables').select('local_id,name').eq('device_id', device),
    ]);
    if (o.error || t.error) {
      setOrders([]); setItems([]);
      setMsg(o.error?.message || t.error?.message || 'Gagal memuat dapur.');
      return;
    }
    const open = o.data as KdsOrder[];
    const incoming = open.filter((x) => !x.split_from_local_id && (x.kds_status || 'incoming') === 'incoming').map((x) => `${x.device_id}-${x.local_id}`);
    if (seen.current && incoming.some((k) => !seen.current!.has(k))) { chime(); haptic([80, 60, 80]); }
    seen.current = new Set([...(seen.current ?? []), ...incoming]);
    setOrders(open);
    setTables(t.data as { local_id: number; name: string }[]);
    if (open.length) {
      const ids = open.map((x) => x.local_id);
      const it = await sb.from('order_items').select('*').eq('device_id', device).in('order_local_id', ids);
      setItems((it.data as KdsItem[]) ?? []);
    } else {
      setItems([]);
    }
    setMsg('');
  }, [device]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => { clearInterval(id); clearInterval(tick); };
  }, [refresh]);

  async function advance(o: KdsOrder, next: string) {
    const sb = await loadSupabase();
    if (!sb) return;
    const { error } = await sb.rpc('advance_kitchen', { p_device: o.device_id, p_order: o.local_id, p_expected: o.kds_status || 'incoming', p_next: next });
    if (error) { setMsg(error.message); return; }
    refresh();
  }

  if (!configured) {
    return (
      <div className="h-full grid place-items-center p-6 text-center text-gray-500">
        <div>
          <div className="font-semibold text-lg mb-2">KDS belum tersambung</div>
          <p className="text-sm">Hubungkan cloud di Pengaturan, lalu simpan pesanan dari tablet kasir agar tiket muncul di sini.</p>
        </div>
      </div>
    );
  }

  // A split bill moves items into separate paid orders; the kitchen still cooks them as one ticket.
  const parentOf = new Map(orders.filter(o => o.split_from_local_id).map(o => [o.local_id, o.split_from_local_id!]));
  const ticketItems = (id: number) => {
    const merged = new Map<string, number>();
    for (const i of items) if ((parentOf.get(i.order_local_id) ?? i.order_local_id) === id) merged.set(i.name, (merged.get(i.name) ?? 0) + i.qty);
    return [...merged].map(([name, qty]) => ({ name, qty }));
  };
  const orderLabel = (o: KdsOrder) => tables.find((t) => t.local_id === o.table_local_id)?.name ?? (o.order_type === 'takeaway' ? 'Takeaway' : 'Dine-in');

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-bold text-xl">Kitchen Display System</h1>
          <p className="text-sm text-gray-500">Tiket dapur dari cloud · diperbarui tiap 8 detik.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={toggleSound} aria-pressed={sound} title={wantSound.current && !sound ? 'Ketuk untuk menyalakan kembali suara setelah halaman dibuka' : 'Bunyi saat ada tiket baru'} className={`h-10 px-4 rounded-lg border text-sm font-medium ${sound ? 'bg-green-100 border-green-300 text-green-800' : 'bg-white border-gray-200'}`}>
            {sound ? '🔔 Suara aktif' : '🔕 Nyalakan suara'}
          </button>
          <button onClick={refresh} className="h-10 px-4 rounded-lg bg-white border border-gray-200 text-sm font-medium">Segarkan</button>
        </div>
      </div>
      {msg && <p className="text-sm text-primary-bright mb-4">{msg}</p>}
      <div className="grid lg:grid-cols-3 gap-4">
        {COLS.map((col) => {
          const list = orders.filter((o) => !o.split_from_local_id && (o.kds_status || 'incoming') === col.key);
          return (
            <div key={col.key} className={`rounded-xl border-2 p-4 ${col.cls}`}>
              <div className="font-semibold mb-3 flex justify-between">{col.label}<span key={list.length} className="kr-pop text-sm text-gray-500">{list.length}</span></div>
              <div className="kr-stagger space-y-3">
                {list.length === 0 && <p className="text-sm text-gray-400">Kosong.</p>}
                {list.map((o) => {
                  // Tickets still waiting after 15 minutes pulse so the kitchen notices them.
                  const late = col.next && now - o.created_at > 15 * 60_000;
                  return (
                  <div key={`${o.device_id}-${o.local_id}`} className={`bg-white rounded-lg border p-3 ${late ? 'kr-urgent border-primary-bright/50' : 'border-gray-200'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold">#{o.local_id} · {orderLabel(o)}</span>
                      <span className={`text-xs ${late ? 'text-primary-bright font-semibold' : 'text-gray-500'}`}>{elapsed(o.created_at, now)}</span>
                    </div>
                    <ul className="text-sm space-y-0.5 mb-3">
                      {ticketItems(o.local_id).map((i, idx) => (
                        <li key={idx}>{i.qty}× {i.name}</li>
                      ))}
                    </ul>
                    {col.next && (
                      <button onClick={() => advance(o, col.next!)} className="w-full h-9 rounded-lg bg-gray-800 text-white text-sm font-semibold">
                        {col.key === 'incoming' ? 'Mulai Masak' : 'Siap Saji'}
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}