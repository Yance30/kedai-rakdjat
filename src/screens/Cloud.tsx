import { useCallback, useEffect, useState } from 'react';
import { rupiah } from '../money';
import { loadSupabase } from '../supabase';
import { AreaChart, DonutChart, RankBars } from '../components/Charts';

interface CloudOrder {
  local_id: number;
  status: string;
  created_at: number;
  total: number;
  order_type: string;
  table_local_id: number | null;
}
interface CloudPayment {
  order_local_id: number;
  method: string;
  amount: number;
  created_at: number;
}
interface CloudTable {
  local_id: number;
  name: string;
  status: string;
}
interface CloudItem {
  order_local_id: number;
  name: string;
  qty: number;
  price: number;
}

const jam = (t: number) => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const midnight = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export default function Cloud() {
  const [configured, setConfigured] = useState(true);
  const [orders, setOrders] = useState<CloudOrder[]>([]);
  const [payments, setPayments] = useState<CloudPayment[]>([]);
  const [tables, setTables] = useState<CloudTable[]>([]);
  const [items, setItems] = useState<CloudItem[]>([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const sb = await loadSupabase();
    if (!sb) {
      setConfigured(false);
      return;
    }
    setConfigured(true);
    setLoading(true);
    const start = midnight(new Date());
    start.setDate(start.getDate() - 6);
    const [o, p, t] = await Promise.all([
      sb.from('orders').select('*').gte('created_at', start.getTime()).order('created_at', { ascending: false }),
      sb.from('payments').select('*').gte('created_at', start.getTime()),
      sb.from('dining_tables').select('*'),
    ]);
    if (o.error || p.error || t.error) {
      setLoading(false);
      setMsg(o.error?.message || p.error?.message || t.error?.message || 'Gagal memuat cloud.');
      return;
    }
    const os = o.data as CloudOrder[];
    const paidIds = os.filter((x) => x.status === 'paid').map((x) => x.local_id);
    let its: CloudItem[] = [];
    if (paidIds.length > 0) {
      const it = await sb.from('order_items').select('*').in('order_local_id', paidIds);
      if (!it.error) its = it.data as CloudItem[];
    }
    setLoading(false);
    setOrders(os);
    setPayments(p.data as CloudPayment[]);
    setTables(t.data as CloudTable[]);
    setItems(its);
    setMsg('');
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const todayStart = midnight(new Date()).getTime();
  const todayOrders = orders.filter((o) => o.created_at >= todayStart);
  const paid = todayOrders.filter((o) => o.status === 'paid');
  const voidIds = new Set(orders.filter((o) => o.status === 'void').map((o) => o.local_id));
  const todayPay = payments.filter((p) => p.created_at >= todayStart);
  const activePay = todayPay.filter((p) => !voidIds.has(p.order_local_id));
  const gross = paid.reduce((s, o) => s + o.total, 0);
  const cash = activePay.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const qris = activePay.filter((p) => p.method === 'qris').reduce((s, p) => s + p.amount, 0);
  const occupied = tables.filter((t) => t.status === 'occupied').length;
  const voidCount = todayOrders.filter((o) => o.status === 'void').length;

  const trend = Array.from({ length: 7 }, (_, i) => {
    const d = midnight(new Date());
    d.setDate(d.getDate() - (6 - i));
    const next = d.getTime() + 86400000;
    const value = orders
      .filter((o) => o.status === 'paid' && o.created_at >= d.getTime() && o.created_at < next)
      .reduce((s, o) => s + o.total, 0);
    return { label: d.toLocaleDateString('id-ID', { weekday: 'short' }), value };
  });
  const yesterday = trend[5].value;
  const growth = yesterday > 0 ? Math.round(((gross - yesterday) / yesterday) * 100) : null;
  const avgTicket = paid.length > 0 ? Math.round(gross / paid.length) : 0;

  const menuTotals = new Map<string, number>();
  const paidIds = new Set(orders.filter((o) => o.status === 'paid').map((o) => o.local_id));
  for (const it of items) {
    if (!paidIds.has(it.order_local_id)) continue;
    menuTotals.set(it.name, (menuTotals.get(it.name) ?? 0) + it.qty * it.price);
  }
  const topMenu = [...menuTotals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  if (!configured) {
    return (
      <div className="h-full grid place-items-center p-6 text-center text-gray-500">
        <div>
          <div className="font-semibold text-lg mb-2">Cloud belum tersambung</div>
          <p className="text-sm">Isi URL & anon key Supabase di Pengaturan → Koneksi Cloud, lalu sync dari tablet kasir.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-bold text-xl">Dashboard Owner</h1>
          <p className="text-sm text-gray-500">Pantauan cloud · hari ini & tren 7 hari · diperbarui otomatis tiap 15 detik.</p>
        </div>
        <button onClick={refresh} disabled={loading} className="h-10 px-4 rounded-lg bg-white border border-gray-200 text-sm font-medium disabled:opacity-40">
          {loading ? 'Memuat…' : 'Segarkan'}
        </button>
      </div>
      {msg && <p className="text-sm text-primary-bright mb-4">{msg}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Omset Hari Ini" value={rupiah(gross)} />
        <Stat label="Transaksi" value={String(paid.length)} />
        <Stat label="Meja Terisi" value={`${occupied} / ${tables.length}`} />
        <Stat label="Void Hari Ini" value={String(voidCount)} alert={voidCount > 0} />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Stat label="Rata-rata / Transaksi" value={rupiah(avgTicket)} />
        <Stat
          label="Pertumbuhan vs Kemarin"
          value={growth === null ? '—' : `${growth > 0 ? '+' : ''}${growth}%`}
          alert={growth !== null && growth < 0}
        />
        <Stat label="Uang Masuk Hari Ini" value={rupiah(cash + qris)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold mb-1">Tren Pemasukan 7 Hari</h2>
          <p className="text-xs text-gray-500 mb-3">Omset pesanan lunas per hari, untuk penilaian kinerja mingguan.</p>
          <AreaChart data={trend} height={170} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold mb-4">Komposisi Pembayaran Hari Ini</h2>
          <DonutChart
            segments={[
              { label: 'Tunai', value: cash, color: '#8a000a' },
              { label: 'QRIS / Online', value: qris, color: '#d4a017' },
            ]}
            centerLabel="uang masuk"
          />
          <div className="flex justify-between text-sm border-t border-gray-200 pt-2 mt-4">
            <span className="text-gray-500">Total uang masuk</span>
            <span className="font-bold text-primary">{rupiah(cash + qris)}</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold mb-1">Menu Terlaris (7 Hari)</h2>
          <p className="text-xs text-gray-500 mb-4">Nilai penjualan per menu — dasar evaluasi menu & stok.</p>
          <RankBars data={topMenu} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold mb-4">Transaksi Terbaru</h2>
          {todayOrders.length === 0 && <p className="text-sm text-gray-400">Belum ada transaksi hari ini.</p>}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {todayOrders.slice(0, 30).map((o) => (
              <div key={o.local_id} className="flex items-center gap-2 text-sm border-b border-gray-100 pb-2">
                <span className="flex-1 text-gray-600">#{o.local_id} · {jam(o.created_at)} · {o.order_type === 'dine_in' ? 'Dine-in' : 'Takeaway'}</span>
                {o.status === 'void' && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-primary-bright">VOID</span>}
                {o.status === 'open' && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">OPEN</span>}
                <span className="font-semibold">{rupiah(o.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-sm">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`font-display font-bold text-xl tabular-nums ${alert ? 'text-primary-bright' : 'text-primary'}`}>{value}</div>
    </div>
  );
}