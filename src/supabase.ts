import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db } from './db';

let client: SupabaseClient | null = null;
let signature = '';
let projectUrl = '';
export function cloudProject() { return projectUrl; }

export async function loadSupabase(): Promise<SupabaseClient | null> {
  const settings = await db.settings.toArray();
  const get = (k: string) => settings.find((s) => s.key === k)?.value ?? '';
  const env = (import.meta as unknown as { env: Record<string, string> }).env ?? {};
  const url = get('supabase_url') || env.VITE_SUPABASE_URL || '';
  const key = get('supabase_anon_key') || env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !key) {
    client?.auth.stopAutoRefresh();
    client = null;
    projectUrl = '';
    return null;
  }
  if (signature !== `${url}|${key}` || !client) {
    client?.auth.stopAutoRefresh();
    client = createClient(url, key);
    signature = `${url}|${key}`;
    projectUrl = url;
  }
  return client;
}

export function getSupabase(): SupabaseClient | null {
  return client;
}

export async function deviceId(): Promise<string> {
  const existing = await db.settings.get('device_id');
  if (existing?.value) return existing.value;
  return db.transaction('rw', db.settings, async () => {
    const found = await db.settings.get('device_id');
    if (found?.value) return found.value;
    const id = 'tab-' + crypto.randomUUID();
    await db.settings.put({ key: 'device_id', value: id });
    return id;
  });
}
