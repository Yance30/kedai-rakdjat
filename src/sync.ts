import Dexie, { cmp, type IntervalTree, type ObservabilitySet } from 'dexie';
import { db } from './db';
import { cloudProject, deviceId, loadSupabase } from './supabase';
import { acknowledge, difference, snapshot, type Ack, type Snapshot } from './sync-payload';

export interface SyncResult {
  ok: boolean;
  msg: string;
}

/** Cloud schema version this app requires (see supabase/migrations). */
export const SCHEMA_VERSION = 5;
const MIGRATIONS = '0002 sampai 0005';

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
    const previous: Snapshot | Ack = JSON.parse(ack?.value ?? '{}');
    const changes = difference(current, previous, dev);
    await db.settings.put({ key: 'sync_pending', value: String(changes.length) });
    // The local data and last acknowledged signatures form a durable change queue.
    if (changes.length || !ack) {
      const schema = await sb.rpc('pos_schema_version');
      if (schema.error || schema.data !== SCHEMA_VERSION) throw new Error(`Migrasi cloud belum sesuai. Jalankan migrasi ${MIGRATIONS} yang belum diterapkan melalui Supabase SQL Editor. Data tetap tersimpan di tablet.`);
      const { error } = await sb.rpc('apply_pos_changes', { p_device: dev, p_changes: changes, p_full: !ack });
      if (error) throw error;
      await db.syncState.put({ key: scope, value: JSON.stringify(acknowledge(current)) });
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

// Tables whose changes must reach the cloud (Dexie table names).
const SYNCED_TABLES = ['staff', 'shifts', 'products', 'meja', 'orders', 'orderItems', 'payments', 'audit', 'ingredients', 'recipes', 'stockMovements', 'expenses'];
const syncedPrefixes = SYNCED_TABLES.map(t => `idb://${db.name}/${t}/`);
/** Settings that change what sync does (e.g. resuming after restore, new cloud credentials). */
const watchedSettings = ['sync_paused', 'supabase_url', 'supabase_anon_key'];
// Mutation parts can arrive from other tabs as plain objects, so walk the interval tree directly.
function treeHasKey(tree: IntervalTree | null | undefined, key: string): boolean {
  if (!tree || !('from' in tree)) return false;
  if (cmp(key, tree.from) >= 0 && cmp(key, tree.to) <= 0) return true;
  return treeHasKey(tree.l, key) || treeHasKey(tree.r, key);
}
export function touchesSyncedData(parts: ObservabilitySet) {
  return Object.keys(parts).some(key => syncedPrefixes.some(p => key.startsWith(p)) ||
    (key.startsWith(`idb://${db.name}/settings/`) && watchedSettings.some(s => treeHasKey(parts[key], s))));
}

const CHANGE_DEBOUNCE = 2_000;
const IDLE_INTERVAL = 120_000;
const MAX_RETRY = 60_000;

/**
 * Syncs shortly after local data changes (in this or another tab), retries with backoff on failure,
 * and otherwise only checks in every few minutes, instead of snapshotting the whole database every 5 s.
 */
export function startSync() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 0;
  let running = false;
  let changedDuringRun = false;
  const schedule = (ms: number) => { clearTimeout(timer); if (!stopped) timer = setTimeout(run, ms); };
  const run = async () => {
    clearTimeout(timer);
    if (stopped) return;
    if (running) { changedDuringRun = true; return; }
    running = true; changedDuringRun = false;
    const result = await pushAll();
    running = false;
    if (stopped) return;
    if (!result.ok) { retryDelay = Math.min(retryDelay ? retryDelay * 2 : 5_000, MAX_RETRY); schedule(retryDelay); }
    else { retryDelay = 0; schedule(changedDuringRun ? CHANGE_DEBOUNCE : IDLE_INTERVAL); }
  };
  const onMutation = (parts: ObservabilitySet) => {
    if (stopped || !touchesSyncedData(parts)) return;
    if (running) changedDuringRun = true;
    else if (!retryDelay) schedule(CHANGE_DEBOUNCE); // while failing, keep the backoff schedule
  };
  const online = () => { retryDelay = 0; void run(); };
  Dexie.on.storagemutated.subscribe(onMutation);
  window.addEventListener('online', online);
  void run();
  return () => {
    stopped = true; clearTimeout(timer);
    Dexie.on.storagemutated.unsubscribe(onMutation);
    window.removeEventListener('online', online);
  };
}
