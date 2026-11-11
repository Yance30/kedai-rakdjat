import 'fake-indexeddb/auto';
import { beforeEach, afterAll, expect, it, vi } from 'vitest';
import { db } from '../src/db';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }));
vi.mock('../src/supabase', () => ({ cloudProject: () => 'project', deviceId: async () => 'device', loadSupabase: async () => ({ auth: { getSession: mocks.getSession }, rpc: mocks.rpc }) }));
import { pushAll } from '../src/sync';
beforeEach(async () => {
  await db.delete(); await db.open();
  mocks.rpc.mockReset().mockImplementation(async (name: string) => ({ error: null, data: name === 'pos_schema_version' ? 4 : null }));
  mocks.getSession.mockResolvedValue({ data: { session: { user: {} } } });
  // Node's Web Locks implementation serializes simultaneous sync requests.
});
afterAll(() => db.close());
it('kegagalan jaringan mempertahankan antrean sampai percobaan ulang berhasil', async () => {
  mocks.rpc.mockResolvedValueOnce({ error: new Error('network down') });
  expect((await pushAll()).ok).toBe(false); expect(await db.syncState.count()).toBe(0);
  expect((await pushAll()).ok).toBe(true); expect(await db.syncState.count()).toBe(1);
  const acknowledgedCalls = mocks.rpc.mock.calls.length;
  await pushAll(); expect(mocks.rpc).toHaveBeenCalledTimes(acknowledgedCalls);
  await db.products.delete(1);
  await pushAll();
  expect(mocks.rpc.mock.lastCall?.[1].p_changes).toEqual([expect.objectContaining({ table: 'products', op: 'delete' })]);
});
it('permintaan serentak tidak mengirim batch ganda', async () => {
  const results = await Promise.all([pushAll(), pushAll(), pushAll()]);
  expect(results.every(r => r.ok)).toBe(true); expect(mocks.rpc).toHaveBeenCalledTimes(2);
});
it('tanpa login atau setelah restore tidak melakukan RPC', async () => {
  mocks.getSession.mockResolvedValueOnce({ data: { session: null } });
  expect((await pushAll()).ok).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  await db.settings.put({ key: 'sync_paused', value: 'true' });
  expect((await pushAll()).ok).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('perubahan saat RPC berlangsung tetap dikirim pada putaran berikutnya', async () => {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'pos_schema_version') return { error: null, data: 4 };
    await db.products.update(1, { name: 'Berubah saat sync' });
    return { error: null };
  });
  expect((await pushAll()).ok).toBe(true);
  db.close(); await db.open();
  expect((await pushAll()).ok).toBe(true);
  expect(mocks.rpc.mock.lastCall?.[1].p_changes).toEqual([expect.objectContaining({ table: 'products', op: 'put', row: expect.objectContaining({ name: 'Berubah saat sync' }) })]);
});
it('schema lama tidak mengakui antrean atau mengirim data parsial', async () => {
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
  expect((await pushAll()).ok).toBe(false);
  expect(await db.syncState.count()).toBe(0);
  expect(mocks.rpc.mock.calls.every(call => call[0] === 'pos_schema_version')).toBe(true);
});
