import { useEffect, useRef, useState } from 'react';
import { db } from './db';
import { draftKey, recoverDraft, saveDraft } from './drafts';
import type { CartDraft, Product } from './types';

export function useCart(shiftId: number, staffId: number, tableId?: number | null) {
  const [cart, setCart] = useState<CartDraft | null>(null);
  const [status, setStatus] = useState('Memuat keranjang…');
  const [error, setError] = useState('');
  const current = useRef<CartDraft | null>(null);
  const queue = useRef(Promise.resolve());
  const failed = useRef(false);
  const [saving, setSaving] = useState(false);
  const key = draftKey(shiftId, staffId, tableId);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let loaded = await recoverDraft(key);
      if (!loaded) {
        const open = tableId ? await db.orders.where('tableId').equals(tableId).and(o => o.status === 'open').first() : undefined;
        const items = open?.id ? await db.orderItems.where('orderId').equals(open.id).toArray() : [];
        const lines = items.map(i => ({ product: { id: i.productId, name: i.name, price: i.price, category: 'Pesanan tersimpan', active: 1 as const }, qty: i.qty }));
        loaded = { key, shiftId, staffId, tableId: tableId ?? null, orderId: open?.id ?? null, requestId: crypto.randomUUID(), orderType: 'dine_in', lines, revision: 0, updatedAt: Date.now() };
      }
      if (!cancelled) { current.current = loaded; setCart(loaded); setStatus(loaded.lines.length ? 'Keranjang dipulihkan dari tablet' : 'Keranjang siap'); }
    })().catch(e => { if (!cancelled) { setError((e as Error).message); failed.current = true; } });
    return () => { cancelled = true; };
  }, [key, shiftId, staffId, tableId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (saving) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saving]);

  function update(lines: { product: Product; qty: number }[], orderType = current.current?.orderType ?? 'dine_in') {
    const old = current.current;
    if (!old || failed.current) return;
    const next = { ...old, lines, orderType, revision: old.revision + 1, updatedAt: Date.now() };
    current.current = next; setCart(next); setSaving(true); setStatus('Menyimpan keranjang…');
    queue.current = queue.current.then(async () => {
      if (failed.current) return;
      await saveDraft(next, old.revision);
      if (current.current?.revision === next.revision) { setSaving(false); setStatus('Keranjang tersimpan di tablet'); }
    }).catch(e => { failed.current = true; setSaving(false); setError((e as Error).message); setStatus('Keranjang belum tersimpan'); });
  }
  async function flush() {
    await queue.current;
    if (failed.current || !current.current) throw new Error(error || 'Keranjang belum siap. Muat ulang halaman.');
    return current.current;
  }
  function completed() {
    if (!current.current) return;
    const next: CartDraft = { ...current.current, lines: [], orderId: null, requestId: crypto.randomUUID(), revision: 0, updatedAt: Date.now() };
    current.current = next; setCart(next); setStatus('Transaksi tersimpan');
  }
  /** Shows lines that were already saved by a transaction (e.g. what is left after a split bill) without writing a draft. */
  function replaceSaved(lines: { product: Product; qty: number }[]) {
    if (!current.current) return;
    const next: CartDraft = { ...current.current, lines, requestId: crypto.randomUUID(), revision: 0, updatedAt: Date.now() };
    current.current = next; setCart(next); setStatus('Sisa pesanan meja');
  }
  return { cart, update, flush, completed, replaceSaved, status, error, saving };
}
