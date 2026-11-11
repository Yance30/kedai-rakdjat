import { db } from './db';
import { cloudProject, deviceId, loadSupabase } from './supabase';
import { difference, snapshot, type Snapshot } from './sync-payload';

export interface SyncResult {
  ok: boolean;
  msg: string;
}

let flight: Promise<SyncResult> | undefined;
export async function exclusive<T>(run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('kr-sync-restore', run);
  throw new Error('Browser perlu mendukung Web Locks melalui HTTPS.');
}
async function synchronize(): Promise<SyncResult> {
  try {
    if ((await db.settings.get('sync_paused'))?.value === 'true') throw new Error('Sync dijeda setelah restore. Periksa data lalu aktifkan kembali.');
    const sb = await loadSupabase();
    if (!sb) throw new Error('Cloud belum dikonfigurasi. Data tersimpan di tablet.');
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Login akun cloud diperlukan. Data tetap tersimpan di tablet.');
    const dev = await deviceId();
    const scope = `${cloudProject()}|${dev}`;
    const current = await snapshot(dev);
    const ack = await db.syncState.get(scope);
    const previous: Snapshot = JSON.parse(ack?.value ?? '{}');
    const changes = difference(current, previous);
    await db.settings.put({ key: 'sync_pending', value: String(changes.length) });
    // The local data and last acknowledged snapshot form a durable change queue.
    if (changes.length || !ack) {
      const schema = await sb.rpc('pos_schema_version');
      if (schema.error || schema.data !== 4) throw new Error('Migrasi cloud belum sesuai. Jalankan migrasi 0002, 0003, dan 0004 yang belum diterapkan melalui Supabase SQL Editor. Data tetap tersimpan di tablet.');
      const { error } = await sb.rpc('apply_pos_changes', { p_device: dev, p_changes: changes, p_full: !ack });
      if (error) throw error;
      await db.syncState.put({ key: scope, value: JSON.stringify(current) });
    }
    await db.settings.bulkPut([
      { key: 'last_sync', value: String(Date.now()) }, { key: 'sync_error', value: '' }, { key: 'sync_pending', value: '0' },
    ]);
    return { ok: true, msg: 'Sync ke cloud berhasil.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
    await db.settings.put({ key: 'sync_error', value: msg });
    return { ok: false, msg };
  }
}

export function pushAll(): Promise<SyncResult> {
  if (!flight) flight = exclusive(synchronize).catch(e => ({ ok: false, msg: String(e) })).finally(() => { flight = undefined; });
  return flight;
}
export function startSync() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let delay = 5_000;
  const run = async () => {
    clearTimeout(timer);
    if (stopped) return;
    const result = await pushAll();
    delay = result.ok ? 5_000 : Math.min(delay * 2, 60_000);
    if (!stopped) timer = setTimeout(run, delay);
  };
  const online = () => { delay = 5_000; void run(); };
  window.addEventListener('online', online);
  void run();
  return () => { stopped = true; clearTimeout(timer); window.removeEventListener('online', online); };
}
