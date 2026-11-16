import { askConfirm } from '../components/Dialog';
import { useEffect, useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { haptic } from '../feedback';
import { rupiah } from '../money';
import { buildReceipt, buildTicket, connectPrinter, printBytes, printerAvailable, printerConnected } from '../printer';
import { pushAll } from '../sync';
import { commitSale, CUSTOMER_NAME_MAX, priceOrder } from '../transactions';
import { useCart } from '../useCart';
import DiscountPanel, { useDiscount } from '../components/cashier/DiscountPanel';
import PayModal from '../components/cashier/PayModal';
import ProductGrid from '../components/cashier/ProductGrid';
import SuccessModal, { type Success } from '../components/cashier/SuccessModal';
import type { CartDraft, Order, OrderItem, Payment, Product, Shift, Staff } from '../types';

type Line = { product: Product; qty: number };

/**
 * Orders are taken and paid at the counter. `legacyTableId` opens a table order saved by an earlier
 * version so it can still be paid (a shift cannot close while it is open).
 */
export default function Cashier({ shift, staff, legacyTableId, onLegacyDone }: {
  shift: Shift;
  staff: Staff;
  legacyTableId?: number | null;
  onLegacyDone?: () => void;
}) {
  const products = useLiveQuery(() => db.products.where('active').equals(1).toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.toArray(), []) ?? [];
  const legacyTable = useLiveQuery(() => (legacyTableId ? db.meja.get(legacyTableId) : undefined), [legacyTableId]);
  const getSetting = (k: string) => settings.find((s) => s.key === k)?.value ?? '';
  const serviceRate = Number(getSetting('service_charge')) || 0;
  const working = useRef(false);
  const draft = useCart(shift.id!, staff.id!, legacyTableId);
  const lines = draft.cart?.lines ?? [];
  const orderType = draft.cart?.orderType ?? 'dine_in';
  const loadedOrderId = draft.cart?.orderId ?? null;
  const [busy, setBusy] = useState(false);
  const [saleError, setSaleError] = useState('');
  const [paying, setPaying] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);
  const [printerName, setPrinterName] = useState('');
  const [printerMsg, setPrinterMsg] = useState('');

  // Split payment: guests at one order pay for their own items; the rest stays in the cart.
  const [splitting, setSplitting] = useState(false);
  const [pick, setPick] = useState<Record<number, number>>({});
  const canSplit = !legacyTableId && lines.reduce((s, l) => s + l.qty, 0) > 1;
  useEffect(() => { if (!canSplit) setSplitting(false); }, [canSplit]);
  useEffect(() => { setPick({}); }, [splitting]);
  const pickedLines = lines.map(l => ({ ...l, qty: Math.min(pick[l.product.id!] ?? 0, l.qty) })).filter(l => l.qty > 0);
  const restLines = lines.map(l => ({ ...l, qty: l.qty - Math.min(pick[l.product.id!] ?? 0, l.qty) })).filter(l => l.qty > 0);
  const billLines = splitting ? pickedLines : lines;

  const subtotal = billLines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const discount = useDiscount(subtotal, JSON.stringify([lines, splitting && pick]));
  const { service, tax, total } = priceOrder(subtotal, discount.amount, serviceRate);

  async function handlePrinter() {
    try { setPrinterName(await connectPrinter()); setPrinterMsg(''); }
    catch (e) { setPrinterMsg((e as Error).message); }
  }
  function add(p: Product) {
    if (busy || splitting || !draft.cart || draft.error || products.find(item => item.id === p.id)?.soldOut) return;
    haptic(10);
    const found = lines.find(l => l.product.id === p.id);
    draft.update(found ? lines.map(l => l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l) : [...lines, { product: p, qty: 1 }]);
  }
  function dec(id: number) {
    if (busy || splitting) return;
    draft.update(lines.map(l => l.product.id === id ? { ...l, qty: l.qty - 1 } : l).filter(l => l.qty > 0));
  }
  const setPicked = (id: number, qty: number, max: number) => setPick(p => ({ ...p, [id]: Math.max(0, Math.min(max, qty)) }));
  const toItems = (orderId: number, ls: Line[]): OrderItem[] => ls.map(l => ({ orderId, productId: l.product.id!, name: l.product.name, qty: l.qty, price: l.product.price }));

  async function confirmPay(method: 'cash' | 'qris', tendered: number) {
    const paid = billLines;
    if (working.current || !paid.length) return;
    working.current = true; setBusy(true); setSaleError(''); setPrinterMsg('');
    try {
      const savedDraft = await draft.flush();
      const partial = splitting && restLines.length > 0;
      const order: Order = {
        shiftId: shift.id!, status: 'paid', createdAt: Date.now(),
        subtotal, discount: discount.amount, discountReason: discount.reason, service, tax, total, orderType,
        customerName: savedDraft.customerName, queueNo: savedDraft.queueNo,
        ...(legacyTableId ? { tableId: legacyTableId } : {}),
      };
      const pay: Payment = { requestId: savedDraft.requestId, orderId: 0, shiftId: shift.id!, method, amount: total, tendered, change: tendered - total, createdAt: Date.now() };
      const remaining: CartDraft | undefined = partial
        ? { ...savedDraft, lines: restLines, requestId: crypto.randomUUID(), revision: savedDraft.revision + 1, updatedAt: Date.now() }
        : undefined;
      const id = await commitSale(order, toItems(0, paid).map(({ orderId: _o, ...i }) => i), pay, staff.id!, loadedOrderId, savedDraft, discount.pin, remaining);
      const saved = (await db.orders.get(id))!;
      if (remaining) draft.continueWith({ ...remaining, queueNo: saved.queueNo });
      else draft.completed();
      discount.clear(); setSplitting(false); setPaying(false);
      if (printerConnected()) {
        const items = toItems(id, paid);
        try {
          await printBytes(buildReceipt(saved, items, { ...pay, orderId: id }, staff.name));
          // Saved table orders were sent to the kitchen when they were saved.
          if (!loadedOrderId) await printBytes(buildTicket(saved, items));
        } catch {
          setPrinterMsg('Pembayaran tersimpan, tetapi struk gagal dicetak. Jangan ulangi pembayaran.');
        }
      }
      haptic([30, 50, 60]);
      setSuccess({ id, queueNo: saved.queueNo, customerName: saved.customerName, total, method, change: tendered - total, partial });
      void pushAll();
    } catch (e) { haptic([60, 40, 60]); setSaleError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }

  return (
    <div className="cashier-layout h-full flex">
      <div className="cashier-menu flex-1 min-w-0 p-6 overflow-y-auto">
        <div className="mb-5"><p className="eyebrow">LAYANAN KEDAI</p><h1 className="text-2xl font-semibold">Kasir & Pesanan</h1><p className="text-sm text-gray-500 mt-1">Pilih menu, periksa pesanan, lalu selesaikan pembayaran.</p></div>
        {printerMsg && <p className="text-xs text-primary-bright mb-3">{printerMsg}</p>}
        <ProductGrid
          products={products}
          onAdd={add}
          toolbar={
            <button
              onClick={handlePrinter}
              disabled={!printerAvailable()}
              title={printerMsg || 'Printer thermal Bluetooth'}
              className={`h-11 px-4 rounded-xl text-sm font-medium disabled:opacity-40 ${printerName ? 'bg-green-100 text-green-700' : 'bg-white border border-gray-200 text-gray-600'}`}
            >
              {printerName ? `Printer: ${printerName}` : 'Hubungkan Printer'}
            </button>
          }
        />
      </div>

      <div className="cashier-basket w-80 shrink-0 bg-white border-l border-gray-200 flex flex-col p-4">
        <p role="status" className="text-xs text-emerald-700 mb-3">{draft.status}</p>
        {draft.error && <p role="alert" className="text-sm text-red-700 mb-2">{draft.error} <button className="underline" onClick={() => location.reload()}>Muat ulang</button></p>}
        <div className="flex items-center justify-between mb-1">
          <div className="font-display font-semibold text-lg">
            {legacyTableId ? `Pesanan Tersimpan${legacyTable?.name ? ` · ${legacyTable.name}` : ''}` : 'Pesanan Baru'}
            {draft.cart?.queueNo && <span className="ml-2 text-sm text-primary">Antrean {draft.cart.queueNo}</span>}
          </div>
          {legacyTableId && <button onClick={() => onLegacyDone?.()} className="text-xs text-gray-500 hover:text-primary">← Kembali ke Kasir</button>}
        </div>
        {!legacyTableId && (
          <>
            <div className="flex gap-1 mb-2 bg-surface rounded-lg p-1">
              {(['dine_in', 'takeaway'] as const).map((t) => (
                <button key={t} disabled={busy || splitting} onClick={() => draft.update(lines, t)}
                  className={`flex-1 px-3 py-1.5 rounded-md text-sm ${orderType === t ? 'bg-white text-primary font-semibold shadow-sm' : 'text-gray-500'}`}>
                  {t === 'dine_in' ? 'Dine-in' : 'Takeaway'}
                </button>
              ))}
            </div>
            <input
              aria-label="Nama pelanggan"
              placeholder="Nama pelanggan (opsional)"
              maxLength={CUSTOMER_NAME_MAX}
              disabled={busy || !draft.cart || !!draft.error}
              value={draft.cart?.customerName ?? ''}
              onChange={(e) => draft.setCustomerName(e.target.value)}
              className="mb-3 h-9 rounded-lg border border-gray-200 px-3 text-sm"
            />
          </>
        )}
        {canSplit && (
          <button disabled={busy} onClick={() => setSplitting(s => !s)} className={`mb-3 h-9 rounded-lg text-sm font-medium border ${splitting ? 'bg-primary text-white border-primary' : 'bg-white text-primary border-primary/30'}`}>
            {splitting ? 'Batal Pisah Bayar' : 'Pisah Bayar'}
          </button>
        )}
        {splitting && <p className="text-xs text-gray-600 mb-2">Pilih item yang dibayar tamu ini. Sisanya tetap di keranjang.</p>}
        <div className="flex-1 overflow-y-auto space-y-3">
          {lines.length > 0 && !splitting && !legacyTableId && <button disabled={busy || draft.saving} onClick={async () => { if (await askConfirm('Semua item di keranjang akan dihapus.', { title: 'Kosongkan keranjang?', confirmLabel: 'Kosongkan', danger: true })) draft.update([]); }} className="text-xs underline text-gray-500 mb-2">Kosongkan keranjang</button>}
          {lines.length === 0 && <p className="text-sm text-gray-400">Belum ada item.</p>}
          {lines.map((l) => {
            const picked = pick[l.product.id!] ?? 0;
            return (
              <div key={l.product.id} className="kr-line-in flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{l.product.name}</div>
                  <div className="text-xs text-gray-500">{rupiah(l.product.price)}{splitting && ` · ${l.qty} dipesan`}</div>
                </div>
                {splitting ? (
                  <div className="flex items-center gap-2" aria-label={`Dibayar terpisah: ${l.product.name}`}>
                    <button onClick={() => setPicked(l.product.id!, picked - 1, l.qty)} className="w-7 h-7 rounded-md bg-gray-100 hover:bg-gray-200">−</button>
                    <span className={`w-9 text-center text-sm ${picked ? 'font-semibold text-primary' : 'text-gray-400'}`}><span key={picked} className="kr-pop">{picked}</span>/{l.qty}</span>
                    <button onClick={() => setPicked(l.product.id!, picked + 1, l.qty)} className="w-7 h-7 rounded-md bg-primary text-white">+</button>
                  </div>
                ) : !legacyTableId && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => dec(l.product.id!)} className="w-7 h-7 rounded-md bg-gray-100 hover:bg-gray-200">−</button>
                    <span className="w-5 text-center text-sm"><span key={l.qty} className="kr-pop font-semibold">{l.qty}</span></span>
                    <button onClick={() => add(l.product)} className="w-7 h-7 rounded-md bg-primary text-white">+</button>
                  </div>
                )}
                {legacyTableId && <span className="text-sm font-semibold">{l.qty}×</span>}
              </div>
            );
          })}
        </div>
        <DiscountPanel d={discount} />
        <div className="border-t border-gray-200 pt-3 mt-3 space-y-1 text-sm">
          {splitting && <div className="text-xs font-semibold text-primary uppercase tracking-wide">Bagian yang dibayar</div>}
          <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{rupiah(subtotal)}</span></div>
          {discount.amount > 0 && <div className="flex justify-between"><span>Diskon</span><span>−{rupiah(discount.amount)}</span></div>}
          {serviceRate > 0 && <div className="flex justify-between"><span className="text-gray-500">Service ({serviceRate}%)</span><span>{rupiah(service)}</span></div>}
          <div className="flex justify-between"><span className="text-gray-500">Pajak (10%)</span><span>{rupiah(tax)}</span></div>
          <div className="flex justify-between font-bold text-base pt-1"><span>Total</span><span key={total} className="kr-pop text-primary font-display text-xl tabular-nums">{rupiah(total)}</span></div>
        </div>
        <button
          onClick={() => setPaying(true)}
          disabled={busy || draft.saving || !!draft.error || billLines.length === 0 || !discount.valid}
          className="mt-3 h-12 rounded-xl bg-gradient-to-r from-primary to-primary-bright text-white font-semibold shadow-md disabled:opacity-40"
        >
          {splitting ? 'Bayar Item Terpilih' : 'Lanjut ke Pembayaran'}
        </button>
      </div>

      {saleError && (
        <div key={saleError} role="alert" className="kr-toast fixed bottom-4 left-4 md:left-24 z-[60] max-w-md bg-red-50 border border-red-200 text-primary p-4 rounded-xl shadow-lg flex items-start gap-3">
          <span className="flex-1">{saleError}</span>
          <button onClick={() => setSaleError('')} className="text-primary/60 hover:text-primary" aria-label="Tutup pesan">✕</button>
        </div>
      )}
      {paying && <PayModal busy={busy} total={total} qrisImage={getSetting('qris_image') || `${import.meta.env.BASE_URL}qris.png`} onCancel={() => { if (!working.current) setPaying(false); }} onConfirm={confirmPay} />}
      {success && (
        <SuccessModal success={success} printerMsg={printerMsg} onClose={() => { const done = !success.partial && legacyTableId; setSuccess(null); if (done) onLegacyDone?.(); }} />
      )}
    </div>
  );
}
