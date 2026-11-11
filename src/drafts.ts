import { db } from './db';
import type { CartDraft } from './types';

export const draftKey = (shiftId: number, staffId: number, tableId?: number | null) => tableId ? `shift:${shiftId}:table:${tableId}` : `shift:${shiftId}:staff:${staffId}:counter`;
export async function saveDraft(draft: CartDraft, expectedRevision: number) {
  return db.transaction('rw', db.drafts, async () => {
    const old = await db.drafts.get(draft.key);
    if ((old?.revision ?? 0) !== expectedRevision) throw new Error('Keranjang berubah di tab lain. Muat ulang agar perubahan tidak tertimpa.');
    const next = { ...draft, revision: expectedRevision + 1, updatedAt: Date.now() };
    await db.drafts.put(next);
    return next;
  });
}
export async function recoverDraft(key: string) {
  return db.transaction('rw', [db.drafts, db.orders, db.payments, db.shifts], async () => {
    const draft = await db.drafts.get(key);
    if (!draft) return undefined;
    const paid = await db.payments.where('requestId').equals(draft.requestId).first();
    const order = draft.orderId ? await db.orders.get(draft.orderId) : undefined;
    if (paid || (draft.orderId && order?.status !== 'open') || (await db.shifts.get(draft.shiftId))?.status !== 'open') {
      await db.drafts.delete(key); return undefined;
    }
    return draft;
  });
}
