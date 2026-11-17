import { lazy, useEffect, useRef, useState } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { SCHEMA_MISMATCH, startSync } from './sync';
import { useWakeLock } from './wake-lock';
import LowStockBanner from './components/LowStockBanner';
import { dailySnapshot, requestPersistentStorage } from './backup';
import CloudAccess from './components/CloudAccess';
const CloudPortal = lazy(() => import('./screens/CloudPortal'));
const Menu = lazy(() => import('./screens/Menu'));
const Expenses = lazy(() => import('./screens/Expenses'));
import SetupGuide from './components/SetupGuide';
const Sales = lazy(() => import('./screens/Sales'));
const Inventory = lazy(() => import('./screens/Inventory'));
import type { Shift, Staff } from './types';
import Login from './screens/Login';
import Cashier from './screens/Cashier';
import Report from './screens/Report';
import History from './screens/History';
const Settings = lazy(() => import('./screens/Settings'));
const Cloud = lazy(() => import('./screens/Cloud'));
const Kds = lazy(() => import('./screens/Kds'));

async function ensureShift(staffId: number): Promise<Shift> {
  return db.transaction('rw', db.shifts, async () => {
    const open = await db.shifts.where('status').equals('open').first();
    if (open) return open;
    const shift: Shift = { staffId, status: 'open', openedAt: Date.now(), openingFloat: 0 };
    shift.id = await db.shifts.add(shift);
    return shift;
  });
}

const ICONS: Record<string, string> = {
  kasir: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z M8 7h8 M8 11h8 M8 15h5',
  keuangan: 'M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4Z',
  riwayat: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6v6l4 2',
  kds: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3 2.5.5 5 2.5 5 6a5 5 0 1 1-10 0c0-1.5.5-3 2-4.5.5 1.5 1 2 1.5 2Z M12 2c1 3 2.5 3.5 4 5 1.5 1.5 3 3.5 3 7',
  cloud: 'M3 3v18h18 M7 15v3 M12 10v8 M17 6v12',
  pengaturan: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  penjualan: 'M3 17l6-6 4 4 8-8 M14 7h7v7',
  menu: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2 M7 2v20 M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7',
  biaya: 'M12 2v20 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  stok: 'M21 8 12 3 3 8v8l9 5 9-5Z M3 8l9 5 9-5 M12 13v8',
  panduan: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z M9 12l2 2 4-4',
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].split(' M').map((seg, i) => (
        <path key={i} d={(i === 0 ? '' : 'M') + seg} />
      ))}
    </svg>
  );
}

export default function App() {
  const [cloudPortal, setCloudPortal] = useState(false);
  const settingsResult = useLiveQuery(() => db.settings.toArray(), []);
  const syncSettings = settingsResult ?? [];
  const generation = useRef<string | null>(null);
  useEffect(() => {
    if (!settingsResult) return;
    const current = settingsResult.find(s => s.key === 'data_generation')?.value ?? '';
    if (generation.current !== null && generation.current !== current) window.location.reload();
    generation.current = current;
  }, [settingsResult]);
  const syncError = syncSettings.find(s => s.key === 'sync_error')?.value;
  const lastSync = syncSettings.find(s => s.key === 'last_sync')?.value;
  useEffect(() => startSync(), []);
  useEffect(() => {
    void requestPersistentStorage();
    // Checked hourly so a tablet left running overnight still gets the next day's copy.
    const daily = () => { void dailySnapshot().catch(() => undefined); };
    daily();
    const id = setInterval(daily, 60 * 60_000);
    return () => clearInterval(id);
  }, []);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [tab, setTab] = useState<'kasir' | 'laporan' | 'riwayat' | 'cloud' | 'kds' | 'pengaturan' | 'penjualan' | 'stok' | 'menu' | 'biaya' | 'panduan'>('kasir');
  // Pesanan/keranjang meja lama (dibuat sebelum fitur meja dihapus) tetap bisa dilunasi,
  // karena tutup shift menolak selama masih ada pesanan terbuka atau keranjang berisi.
  const [activeTable, setActiveTable] = useState<number | null>(null);
  const legacyTables = useLiveQuery(async () => {
    const open = await db.orders.where('status').equals('open').filter(o => !!o.tableId).toArray();
    const carts = await db.drafts.filter(d => !!d.tableId && d.shiftId === shift?.id && d.lines.length > 0).toArray();
    const ids = [...new Set([...open.map(o => o.tableId!), ...carts.map(d => d.tableId!)])];
    const names = new Map((await db.meja.bulkGet(ids)).map((t, i) => [ids[i], t?.name ?? `#${ids[i]}`]));
    return ids.map(id => ({ id, name: names.get(id)! }));
  }, [shift?.id]) ?? [];
  const [ready, setReady] = useState(false);
  // Keep the screen on for signed-in staff: counter and KDS tablets sit idle between orders.
  useWakeLock(!!staff);
  const [online, setOnline] = useState(navigator.onLine);

  function go(t: typeof tab) {
    setActiveTable(null);
    setTab(t);
  }

  useEffect(() => {
    db.shifts.where('status').equals('open').first().then((s) => {
      setShift(s ?? null);
      setReady(true);
    });
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (!ready) {
    return (
      <div className="h-full grid place-items-center kr-shell">
        <div className="text-center kr-zoom">
          <div className="kr-breathe w-16 h-16 rounded-full border border-brass/60 grid place-items-center font-display font-bold text-brass-soft text-2xl mx-auto mb-4">KR</div>
          <div className="font-display font-semibold text-2xl text-white">Kedai Rakdjat</div>
        </div>
      </div>
    );
  }

  if (cloudPortal) return <CloudPortal onBack={() => setCloudPortal(false)} />;
  if (!staff) {
    return (
      <Login
        onCloud={() => setCloudPortal(true)}
        onLogin={async (s) => {
          setStaff(s);
          setShift(await ensureShift(s.id!));
          setTab('kasir');
        }}
      />
    );
  }

  if (!shift) {
    return <div className="h-full grid place-items-center text-gray-500"><span className="kr-breathe">Memuat…</span></div>;
  }

  const nav: { key: typeof tab; label: string; icon: string; ownerOnly?: boolean; active?: boolean }[] = [
    { key: 'kasir', label: 'Kasir', icon: 'kasir' },
    { key: 'laporan', label: 'Keuangan', icon: 'keuangan' },
    { key: 'riwayat', label: 'Riwayat', icon: 'riwayat' },
    { key: 'penjualan', label: 'Laporan Penjualan', icon: 'penjualan', ownerOnly: true },
    { key: 'menu', label: 'Kelola Menu', icon: 'menu', ownerOnly: true },
    { key: 'biaya', label: 'Pengeluaran', icon: 'biaya', ownerOnly: true },
    { key: 'panduan', label: 'Panduan & Backup', icon: 'panduan', ownerOnly: true },
    { key: 'stok', label: 'Stok & Resep', icon: 'stok', ownerOnly: true },
    { key: 'kds', label: 'KDS Dapur', icon: 'kds' },
    { key: 'cloud', label: 'Dashboard Owner', icon: 'cloud', ownerOnly: true },
    { key: 'pengaturan', label: 'Pengaturan', icon: 'pengaturan' },
  ];

  return (
    <div className="app-layout h-full flex">
      <aside className="app-sidebar w-60 shrink-0 kr-shell text-white flex flex-col p-4">
        <div className="flex items-center gap-3 px-2 pt-1 mb-6">
          <div className="w-11 h-11 rounded-full border border-brass/60 grid place-items-center font-display font-bold text-brass-soft text-lg">
            KR
          </div>
          <div>
            <div className="font-display font-semibold text-lg leading-tight">Kedai Rakdjat</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-brass-soft/80">Main Branch</div>
          </div>
        </div>
        <div className="h-px bg-white/10 mx-2 mb-4" />
        <nav className="kr-stagger space-y-1 overflow-y-auto min-h-0">
          {nav
            .filter((n) => !n.ownerOnly || staff.role === 'owner')
            .map((n) => {
              const active = n.active ?? tab === n.key;
              return (
                <button
                  key={n.key}
                  onClick={() => go(n.key)}
                  className={`relative w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-left ${
                    active ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {active && <span className="kr-indicator absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r bg-brass" />}
                  <Icon name={n.icon} />
                  {n.label}
                </button>
              );
            })}
        </nav>
        <div className="mt-auto pt-2">
          {staff.role === 'owner' && (!syncSettings.find(s=>s.key==='last_backup_download') || Date.now()-Number(syncSettings.find(s=>s.key==='last_backup_download')?.value)>86400000) && <button className="text-xs text-amber-200 p-2" onClick={()=>go('panduan')}>Pengingat: unduh backup hari ini</button>}
          <div className="flex items-center gap-2 px-2 mb-3 text-xs text-white/50">
            <span className={`kr-live w-2 h-2 rounded-full ${online ? 'bg-green-400' : 'bg-red-400'}`} />
            {online ? (syncError ? 'Online · sync menunggu' : lastSync ? 'Online · sync berhasil' : 'Online · belum sync') : 'Offline · mode lokal'}
          </div>
          <div className="bg-white/5 rounded-xl p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brass/20 text-brass-soft grid place-items-center font-bold text-sm shrink-0">
              {staff.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{staff.name}</div>
              <div className="text-xs text-white/50 capitalize">{staff.role}</div>
            </div>
            <button onClick={() => setStaff(null)} className="text-xs text-white/50 hover:text-brass-soft" title="Keluar">
              Keluar
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col">
        {staff.role === 'owner' && syncError?.startsWith(SCHEMA_MISMATCH) && (
          <div role="alert" className="shrink-0 bg-red-50 border-b border-red-200 px-6 py-2 text-sm text-red-900 flex flex-wrap items-center gap-2">
            <strong>Sinkronisasi cloud berhenti:</strong>
            <span>database cloud belum memakai migrasi terbaru. Transaksi tetap tersimpan di tablet.</span>
            <button onClick={() => go('pengaturan')} className="underline font-semibold">Buka Pemeriksaan Kesiapan</button>
          </div>
        )}
        <div key={tab + (activeTable ?? '')} className="flex-1 min-h-0 kr-page">
          {tab === 'kasir' ? (
            <div className="h-full flex flex-col">
              {!activeTable && <LowStockBanner className="shrink-0 border-b px-6 py-2" onOpen={staff.role === 'owner' ? () => go('stok') : undefined} />}
              {!activeTable && legacyTables.length > 0 && (
                <div role="status" className="shrink-0 bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-900 flex flex-wrap items-center gap-2">
                  <span>Pesanan dari versi lama belum dibayar:</span>
                  {legacyTables.map(t => (
                    <button key={t.id} onClick={() => setActiveTable(t.id)} className="underline font-semibold">{t.name} · Selesaikan</button>
                  ))}
                </div>
              )}
              <div className="flex-1 min-h-0">
                <Cashier
                  key={activeTable ?? 'counter'}
                  shift={shift}
                  staff={staff}
                  legacyTableId={activeTable}
                  onLegacyDone={() => setActiveTable(null)}
                />
              </div>
            </div>
          ) : tab === 'laporan' ? (
            <Report shift={shift} actorId={staff.id!} onClosed={() => { setShift(null); setStaff(null); }} />
          ) : tab === 'riwayat' ? (
            <History shift={shift} actor={staff} />
          ) : tab === 'kds' ? (
            <CloudAccess roles={['owner', 'kitchen']}>{device => <Kds key={device} device={device} />}</CloudAccess>
          ) : tab === 'penjualan' && staff.role === 'owner' ? (
            <Sales />
          ) : tab === 'menu' && staff.role === 'owner' ? (
            <Menu actor={staff} />
          ) : tab === 'biaya' && staff.role === 'owner' ? (
            <Expenses actor={staff} />
          ) : tab === 'panduan' && staff.role === 'owner' ? (
            <SetupGuide onNavigate={go} />
          ) : tab === 'stok' && staff.role === 'owner' ? (
            <Inventory actor={staff} />
          ) : tab === 'cloud' && staff.role === 'owner' ? (
            <CloudAccess roles={['owner']}>{device => <Cloud key={device} device={device} />}</CloudAccess>
          ) : (
            <Settings staff={staff} />
          )}
        </div>
      </main>
    </div>
  );
}
