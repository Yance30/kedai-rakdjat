import { useEffect, useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { rupiah } from '../money';
import { buildBill, buildReceipt, buildTicket, connectPrinter, printBytes, printerAvailable, printerConnected } from '../printer';
import { pushAll } from '../sync';
import { commitSale, commitSplit, priceOrder, validateSale } from '../transactions';
import { useCart } from '../useCart';
import type { DiningTable, Order, OrderItem, Payment, Product, Shift, Staff } from '../types';

interface Line {
  product: Product;
  qty: number;
}

interface Success {
  id: number;
  total: number;
  method: 'cash' | 'qris';
  change: number;
  split?: boolean;
}

export default function Cashier({
  shift,
  staff,
  tableId,
  onTableDone,
}: {
  shift: Shift;
  staff: Staff;
  tableId?: number | null;
  onTableDone?: () => void;
}) {
  const products = useLiveQuery(() => db.products.where('active').equals(1).toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.toArray(), []) ?? [];
  const table = useLiveQuery(() => (tableId ? db.meja.get(tableId) : undefined), [tableId]);
  const getSetting = (k: string) => settings.find((s) => s.key === k)?.value ?? '';
  const serviceRate = Number(getSetting('service_charge')) || 0;
  const working = useRef(false);
  const draft = useCart(shift.id!, staff.id!, tableId);
  const lines = draft.cart?.lines ?? [];
  const orderType = draft.cart?.orderType ?? 'dine_in';
  const loadedOrderId = draft.cart?.orderId ?? null;
  const [busy, setBusy] = useState(false);
  const [saleError, setSaleError] = useState('');
  const [cat, setCat] = useState('Semua');
  const [q, setQ] = useState('');
  const [paying, setPaying] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);
  const [printerName, setPrinterName] = useState('');
  const [printerMsg, setPrinterMsg] = useState('');
  async function handlePrinter() {
    try {
      setPrinterName(await connectPrinter());
      setPrinterMsg('');
    } catch (e) {
      setPrinterMsg((e as Error).message);
    }
  }

  const cats = ['Semua', ...Array.from(new Set(products.map((p) => p.category)))];
  const shown = products.filter(
    (p) => (cat === 'Semua' || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase()),
  );

  const [discountMode,setDiscountMode]=useState('rupiah');
  const [discountInput,setDiscountInput]=useState('');
  const [discountReason,setDiscountReason]=useState('');
  const [discountPin,setDiscountPin]=useState('');
  // Split bill: pay selected items of a saved table order separately.
  const [splitting, setSplitting] = useState(false);
  const [pick, setPick] = useState<Record<number, number>>({});
  const splitRequest = useRef<string | null>(null);
  const savedItems = useLiveQuery(() => loadedOrderId ? db.orderItems.where('orderId').equals(loadedOrderId).toArray() : [], [loadedOrderId]);
  const savedMatches = !!savedItems && savedItems.length === lines.length && lines.every(l => savedItems.some(i => i.productId === l.product.id && i.qty === l.qty && i.price === l.product.price));
  const canSplit = !!tableId && !!loadedOrderId && savedMatches && lines.reduce((s, l) => s + l.qty, 0) > 1;
  useEffect(() => { if (!canSplit) setSplitting(false); }, [canSplit]);
  useEffect(() => { setPick({}); }, [splitting]);
  const pickedLines = lines.map(l => ({ ...l, qty: Math.min(pick[l.product.id!] ?? 0, l.qty) })).filter(l => l.qty > 0);
  const pickedAll = pickedLines.length > 0 && lines.every(l => (pick[l.product.id!] ?? 0) >= l.qty);
  const billLines = splitting ? pickedLines : lines;

  const cartSignature=JSON.stringify([lines, splitting && pick]);
  useEffect(()=>{setDiscountInput('');setDiscountReason('');setDiscountPin('');splitRequest.current=null;},[cartSignature]);
  const subtotal = billLines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const discount=discountMode==='persen'?Math.round(subtotal*Number(discountInput)/100):Number(discountInput);
  const discountValid=Number.isSafeInteger(discount)&&discount>=0&&(subtotal===0?discount===0:discount<subtotal)&&Number(discountInput)>=0;
  const { service, tax, total } = priceOrder(subtotal, discount, serviceRate);

  function add(p: Product) {
    if (busy || splitting || !draft.cart || draft.error || products.find(item=>item.id===p.id)?.soldOut) return;
    const found = lines.find(l => l.product.id === p.id);
    draft.update(found ? lines.map(l => l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l) : [...lines, { product: p, qty: 1 }]);
  }
  function dec(id: number) {
    if (busy || splitting) return;
    draft.update(lines.map(l => l.product.id === id ? { ...l, qty: l.qty - 1 } : l).filter(l => l.qty > 0));
  }
  function setPicked(id: number, qty: number, max: number) {
    setPick(p => ({ ...p, [id]: Math.max(0, Math.min(max, qty)) }));
  }

  async function confirmSplit(method: 'cash' | 'qris', tendered: number) {
    if (working.current || !loadedOrderId || !pickedLines.length || pickedAll) return;
    working.current = true; setBusy(true); setSaleError(''); setPrinterMsg('');
    try {
      splitRequest.current ??= crypto.randomUUID();
      const pay: Payment = { requestId: splitRequest.current, orderId: 0, shiftId: shift.id!, method, amount: total, tendered, change: tendered - total, createdAt: Date.now() };
      const id = await commitSplit(loadedOrderId, pickedLines.map(l => ({ productId: l.product.id!, qty: l.qty })), pay, staff.id!, serviceRate,
        discount > 0 ? { amount: discount, reason: discountReason, pin: discountPin } : undefined);
      splitRequest.current = null;
      draft.replaceSaved(lines.map(l => ({ ...l, qty: l.qty - Math.min(pick[l.product.id!] ?? 0, l.qty) })).filter(l => l.qty > 0));
      setSplitting(false); setPaying(false); setDiscountPin(''); setDiscountInput('');
      if (printerConnected()) {
        try {
          const order = (await db.orders.get(id))!;
          await printBytes(buildReceipt(order, await db.orderItems.where('orderId').equals(id).toArray(), { ...pay, orderId: id }, staff.name));
        } catch {
          setPrinterMsg('Pembayaran tersimpan, tetapi struk gagal dicetak. Jangan ulangi pembayaran.');
        }
      }
      setSuccess({ id, total, method, change: tendered - total, split: true });
      void pushAll();
    } catch (e) { setSaleError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }

  async function confirmPay(method: 'cash' | 'qris', tendered: number) {
    if (splitting) return confirmSplit(method, tendered);
    if (working.current || !lines.length) return;
    working.current = true; setBusy(true); setSaleError(''); setPrinterMsg('');
    try {
    const savedDraft = await draft.flush();
    const order: Order = {
      shiftId: shift.id!,
      status: 'paid',
      createdAt: Date.now(),
      subtotal,
      discount, discountReason,
      service,
      tax,
      total,
      orderType,
      ...(tableId ? { tableId } : {}),
    };
    const pay: Payment = {
      requestId: savedDraft.requestId,
      orderId: 0,
      shiftId: shift.id!,
      method,
      amount: total,
      tendered,
      change: tendered - total,
      createdAt: Date.now(),
    };
    const id = await commitSale(order, lines.map(l => ({ productId: l.product.id!, name: l.product.name, qty: l.qty, price: l.product.price })), pay, staff.id!, loadedOrderId, savedDraft, discountPin);
    draft.completed();
    setDiscountPin('');setDiscountInput('');
    setPaying(false);
    if (printerConnected()) {
      const items: OrderItem[] = lines.map((l) => ({
        orderId: id,
        productId: l.product.id!,
        name: l.product.name,
        qty: l.qty,
        price: l.product.price,
      }));
      try {
        await printBytes(buildReceipt({ ...order, id }, items, pay, staff.name));
        if (!tableId && orderType === 'dine_in') await printBytes(buildTicket({ ...order, id }, items));
      } catch {
        setPrinterMsg('Pembayaran tersimpan, tetapi struk gagal dicetak. Jangan ulangi pembayaran.');
      }
    }
    setSuccess({ id, total, method, change: tendered - total });
    setPaying(false);
    void pushAll();
    } catch (e) { setSaleError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }

  async function saveOrder() {
    if (!tableId || lines.length === 0 || working.current) return;
    working.current = true; setBusy(true); setSaleError('');
    try {
    const savedDraft = await draft.flush();
    const order: Order = {
      shiftId: shift.id!,
      status: 'open',
      createdAt: Date.now(),
      subtotal,
      service,
      tax,
      total,
      orderType: 'dine_in',
      tableId,
    };
    validateSale(order, lines.map(l => ({ productId: l.product.id!, name: l.product.name, qty: l.qty, price: l.product.price })));
    const id = await db.transaction('rw', db.orders, db.orderItems, db.meja, db.shifts, db.drafts, async () => {
      if (((await db.drafts.get(savedDraft.key))?.revision ?? 0) !== savedDraft.revision) throw new Error('Keranjang berubah di tab lain. Muat ulang.');
      if ((await db.shifts.get(shift.id!))?.status !== 'open') throw new Error('Shift sudah ditutup.');
      if (loadedOrderId && (await db.orders.get(loadedOrderId))?.status !== 'open') throw new Error('Pesanan sudah berubah. Muat ulang meja.');
      if (!loadedOrderId && await db.orders.where('tableId').equals(tableId).and(o => o.status === 'open').count()) throw new Error('Meja sudah memiliki pesanan. Muat ulang meja.');
      let orderId: number;
      if (loadedOrderId) {
        orderId = loadedOrderId;
        const { createdAt: _c, ...fields } = order;
        await db.orders.update(orderId, fields);
        await db.orderItems.where('orderId').equals(orderId).delete();
      } else {
        orderId = await db.orders.add(order);
      }
      await db.orderItems.bulkAdd(
        lines.map((l) => ({
          orderId,
          productId: l.product.id!,
          name: l.product.name,
          qty: l.qty,
          price: l.product.price,
        })),
      );
      await db.meja.update(tableId, { status: 'occupied' });
      await db.drafts.delete(savedDraft.key);
      return orderId;
    });
    if (printerConnected()) {
      const items: OrderItem[] = lines.map((l) => ({
        orderId: id,
        productId: l.product.id!,
        name: l.product.name,
        qty: l.qty,
        price: l.product.price,
      }));
      try {
        await printBytes(buildTicket({ ...order, id }, items, table?.name));
      } catch {
        // gagal cetak tidak boleh memblokir penyimpanan pesanan
      }
    }
    draft.completed();
    void pushAll();
    onTableDone?.();
    } catch (e) { setSaleError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }

  async function printBill() {
    if (billLines.length === 0) return;
    const order: Order = {
      shiftId: shift.id!,
      status: 'open',
      createdAt: Date.now(),
      subtotal,
      service,
      tax,
      total,
      orderType,
      ...(tableId ? { tableId } : {}),
    };
    const items: OrderItem[] = billLines.map((l) => ({
      orderId: loadedOrderId ?? 0,
      productId: l.product.id!,
      name: l.product.name,
      qty: l.qty,
      price: l.product.price,
    }));
    try {
      await printBytes(buildBill(order, items, staff.name, table?.name));
      setPrinterMsg('');
    } catch (e) {
      setPrinterMsg((e as Error).message);
    }
  }

  return (
    <div className="cashier-layout h-full flex">
      <div className="cashier-menu flex-1 min-w-0 p-6 overflow-y-auto">
        <div className="mb-5"><p className="eyebrow">LAYANAN KEDAI</p><h1 className="text-2xl font-semibold">Kasir & Pesanan</h1><p className="text-sm text-gray-500 mt-1">Pilih menu, periksa pesanan, lalu selesaikan pembayaran.</p></div>
        <div className="flex gap-2 mb-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari menu..."
            className="flex-1 h-11 rounded-xl border border-gray-200 bg-white px-4 shadow-sm"
          />
          <button
            onClick={handlePrinter}
            disabled={!printerAvailable()}
            title={printerMsg || 'Printer thermal Bluetooth'}
            className={`h-11 px-4 rounded-xl text-sm font-medium disabled:opacity-40 ${printerName ? 'bg-green-100 text-green-700' : 'bg-white border border-gray-200 text-gray-600'}`}
          >
            {printerName ? `Printer: ${printerName}` : 'Hubungkan Printer'}
          </button>
        </div>
        {printerMsg && <p className="text-xs text-primary-bright mb-3">{printerMsg}</p>}
        <div className="flex gap-2 flex-wrap mb-6">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`px-4 py-2 rounded-full text-sm font-medium ${cat === c ? 'bg-primary text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:border-primary/40'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {shown.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-200/80 p-4 flex flex-col shadow-sm transition hover:shadow-md hover:-translate-y-0.5">
              {p.photo ? (
                <img src={p.photo} alt={p.name} className="h-28 w-full object-cover rounded-xl mb-3" />
              ) : (
                <div className="h-28 rounded-xl bg-gradient-to-br from-maroon to-primary mb-3 grid place-items-center text-brass-soft font-display font-semibold text-xl px-2 text-center">
                  {p.name.split(' ')[0]}
                </div>
              )}
              <div className="font-semibold truncate">{p.name}</div>
              <div className="text-primary font-bold mb-3 tabular-nums">{rupiah(p.price)}</div>
              <button
                disabled={p.soldOut}
                onClick={() => add(p)}
                className="mt-auto h-10 rounded-xl bg-primary/5 text-primary border border-primary/15 font-semibold hover:bg-primary hover:text-white"
              >
                {p.soldOut ? 'Habis' : '+ Tambah'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="cashier-basket w-80 shrink-0 bg-white border-l border-gray-200 flex flex-col p-4">
        <p role="status" className="text-xs text-emerald-700 mb-3">{draft.status}</p>
        {draft.error && <p role="alert" className="text-sm text-red-700 mb-2">{draft.error} <button className="underline" onClick={() => location.reload()}>Muat ulang</button></p>}
        <div className="flex items-center justify-between mb-1">
          <div className="font-display font-semibold text-lg">{tableId ? `Meja ${table?.name ?? ''}` : 'Pesanan Baru'}</div>
          {tableId && (
            <button onClick={() => onTableDone?.()} className="text-xs text-gray-500 hover:text-primary">← Denah Meja</button>
          )}
        </div>
        {!tableId && (
          <div className="flex gap-1 mb-4 bg-surface rounded-lg p-1">
            {(['dine_in', 'takeaway'] as const).map((t) => (
              <button
                key={t}
                onClick={() => draft.update(lines, t)}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm ${orderType === t ? 'bg-white text-primary font-semibold shadow-sm' : 'text-gray-500'}`}
              >
                {t === 'dine_in' ? 'Dine-in' : 'Takeaway'}
              </button>
            ))}
          </div>
        )}
        {tableId && loadedOrderId && lines.length > 0 && (
          canSplit ? (
            <button disabled={busy} onClick={() => setSplitting(s => !s)} className={`mb-3 h-9 rounded-lg text-sm font-medium border ${splitting ? 'bg-primary text-white border-primary' : 'bg-white text-primary border-primary/30'}`}>
              {splitting ? 'Batal Pisah Bill' : 'Pisah Bill'}
            </button>
          ) : !savedMatches && <p className="text-xs text-gray-500 mb-3">Simpan & kirim ke dapur dulu untuk memisah bill.</p>
        )}
        {splitting && <p className="text-xs text-gray-600 mb-2">Pilih item yang dibayar tamu ini. Sisanya tetap di meja.</p>}
        <div className="flex-1 overflow-y-auto space-y-3">
          {lines.length > 0 && !splitting && <button disabled={busy || draft.saving} onClick={() => { if (confirm('Kosongkan keranjang ini? Pesanan yang sudah dikirim ke dapur tetap tersimpan.')) draft.update([]); }} className="text-xs underline text-gray-500 mb-2">Kosongkan keranjang</button>}
          {lines.length === 0 && <p className="text-sm text-gray-400">Belum ada item.</p>}
          {lines.map((l) => {
            const picked = pick[l.product.id!] ?? 0;
            return (
            <div key={l.product.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{l.product.name}</div>
                <div className="text-xs text-gray-500">{rupiah(l.product.price)}{splitting && ` · ${l.qty} di meja`}</div>
              </div>
              {splitting ? (
                <div className="flex items-center gap-2" aria-label={`Dibayar terpisah: ${l.product.name}`}>
                  <button onClick={() => setPicked(l.product.id!, picked - 1, l.qty)} className="w-7 h-7 rounded-md bg-gray-100 hover:bg-gray-200">−</button>
                  <span className={`w-9 text-center text-sm ${picked ? 'font-semibold text-primary' : 'text-gray-400'}`}>{picked}/{l.qty}</span>
                  <button onClick={() => setPicked(l.product.id!, picked + 1, l.qty)} className="w-7 h-7 rounded-md bg-primary text-white">+</button>
                </div>
              ) : (
              <div className="flex items-center gap-2">
                <button onClick={() => dec(l.product.id!)} className="w-7 h-7 rounded-md bg-gray-100 hover:bg-gray-200">−</button>
                <span className="w-5 text-center text-sm">{l.qty}</span>
                <button onClick={() => add(l.product)} className="w-7 h-7 rounded-md bg-primary text-white">+</button>
              </div>
              )}
            </div>
            );
          })}
        </div>
        <details className="mt-3 text-sm"><summary className="cursor-pointer py-2">Diskon dengan PIN owner</summary><div className="space-y-2">
          <label>Jenis diskon<select aria-label="Jenis diskon" className="w-full border rounded p-2" value={discountMode} onChange={e=>{setDiscountMode(e.target.value);setDiscountInput('');}}><option value="rupiah">Rupiah</option><option value="persen">Persen</option></select></label>
          <label>Nilai diskon<input aria-label="Nilai diskon" className="w-full border rounded p-2" type="number" min="0" value={discountInput} onChange={e=>setDiscountInput(e.target.value)}/></label>
          {discount>0&&<><label>Alasan diskon<input aria-label="Alasan diskon" className="w-full border rounded p-2" value={discountReason} onChange={e=>setDiscountReason(e.target.value)}/></label><label>PIN owner diskon<input aria-label="PIN owner diskon" className="w-full border rounded p-2" type="password" inputMode="numeric" autoComplete="off" value={discountPin} onChange={e=>setDiscountPin(e.target.value)}/></label><p className="text-xs text-gray-500">Diskon diterapkan sebelum service dan pajak; persetujuan dicatat saat pembayaran. PIN tidak disimpan.</p></>}
          {!discountValid&&<p role="alert">Diskon harus lebih kecil dari subtotal.</p>}</div></details>
        <div className="border-t border-gray-200 pt-3 mt-3 space-y-1 text-sm">
          {splitting && <div className="text-xs font-semibold text-primary uppercase tracking-wide">Bagian yang dibayar</div>}
          <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{rupiah(subtotal)}</span></div>
          {discount>0&&<div className="flex justify-between"><span>Diskon</span><span>−{rupiah(discount)}</span></div>}
          {serviceRate > 0 && (
            <div className="flex justify-between"><span className="text-gray-500">Service ({serviceRate}%)</span><span>{rupiah(service)}</span></div>
          )}
          <div className="flex justify-between"><span className="text-gray-500">Pajak (10%)</span><span>{rupiah(tax)}</span></div>
          <div className="flex justify-between font-bold text-base pt-1"><span>Total</span><span className="text-primary font-display text-xl tabular-nums">{rupiah(total)}</span></div>
        </div>
        {tableId && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={saveOrder}
              disabled={busy || splitting || draft.saving || !!draft.error || lines.length === 0 || discount !== 0}
              className="flex-1 h-11 rounded-lg bg-gray-800 text-white font-semibold disabled:opacity-40"
            >
              Simpan & ke Dapur
            </button>
            <button
              onClick={printBill}
              disabled={billLines.length === 0 || !printerConnected()}
              title={!printerConnected() ? 'Hubungkan printer dulu' : 'Cetak bill sementara'}
              className="flex-1 h-11 rounded-lg bg-white border border-gray-300 text-gray-700 font-semibold disabled:opacity-40"
            >
              Bill Sementara
            </button>
          </div>
        )}
        {splitting && pickedAll && <p className="text-xs text-gray-500 mt-2">Semua item terpilih. Batalkan pisah bill dan bayar seluruh sisa pesanan.</p>}
        <button
          onClick={() => setPaying(true)}
          disabled={busy || draft.saving || !!draft.error || lines.length === 0 || !discountValid || (splitting && (!pickedLines.length || pickedAll))}
          className="mt-3 h-12 rounded-xl bg-gradient-to-r from-primary to-primary-bright text-white font-semibold shadow-md disabled:opacity-40"
        >
          {splitting ? 'Bayar Item Terpilih' : 'Lanjut ke Pembayaran'}
        </button>
      </div>

      {saleError && <div role="alert" className="fixed bottom-4 left-4 md:left-24 z-[60] bg-red-50 text-primary p-4 rounded shadow">{saleError}</div>}
      {paying && <PayModal busy={busy} total={total} qrisImage={getSetting('qris_image') || `${import.meta.env.BASE_URL}qris.png`} onCancel={() => { if (!working.current) setPaying(false); }} onConfirm={confirmPay} />}

      {success && (
        <div className="fixed inset-0 bg-maroon-deep/50 backdrop-blur-sm grid place-items-center z-50">
          <div className="w-96 bg-white rounded-3xl p-8 text-center shadow-xl kr-zoom">
            <div className="w-14 h-14 rounded-full bg-green-100 text-green-700 grid place-items-center text-2xl mx-auto mb-4">✓</div>
            <h2 className="font-display font-bold text-xl mb-1">Pembayaran Berhasil</h2>
            {printerMsg && <p role="alert" className="text-sm text-primary mb-2">{printerMsg}</p>}
            <p className="text-sm text-gray-500 mb-4">Order #{success.id} · {success.method === 'cash' ? 'Tunai' : 'QRIS'}</p>
            <div className="text-3xl font-display font-bold text-primary mb-1 tabular-nums">{rupiah(success.total)}</div>
            {success.method === 'cash' && (
              <div className="text-sm text-gray-600 mb-4">Kembalian: <span className="font-semibold">{rupiah(success.change)}</span></div>
            )}
            {success.split && <p className="text-sm text-gray-500 mb-2">Bill terpisah lunas. Sisa pesanan tetap terbuka di meja ini.</p>}
            <button onClick={() => { const split = success.split; setSuccess(null); if (tableId && !split) onTableDone?.(); }} className="w-full h-12 rounded-lg bg-primary text-white font-semibold mt-2">
              {success.split ? 'Lanjutkan Sisa Pesanan' : tableId ? 'Kembali ke Denah Meja' : 'Transaksi Baru'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PayModal({
  busy,
  total,
  qrisImage,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  total: number;
  qrisImage?: string;
  onCancel: () => void;
  onConfirm: (method: 'cash' | 'qris', tendered: number) => void;
}) {
  const [method, setMethod] = useState<'cash' | 'qris'>('cash');
  const [tendered, setTendered] = useState('');
  const cashValid = Number(tendered) >= total;

  return (
    <div className="fixed inset-0 bg-maroon-deep/50 backdrop-blur-sm grid place-items-center z-50">
      <div className="w-[28rem] bg-white rounded-3xl p-6 shadow-xl kr-zoom">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-display font-bold text-lg">Pembayaran</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="text-center text-4xl font-display font-bold text-primary mb-6 tabular-nums">{rupiah(total)}</div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setMethod('cash')}
            className={`h-11 rounded-lg font-medium ${method === 'cash' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Tunai
          </button>
          <button
            onClick={() => setMethod('qris')}
            className={`h-11 rounded-lg font-medium ${method === 'qris' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            QRIS
          </button>
        </div>
        {method === 'cash' ? (
          <>
            <input
              type="number"
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
              placeholder="Uang diterima"
              className="w-full h-12 rounded-lg border border-gray-300 px-4 text-lg mb-3"
            />
            <div className="flex gap-2 flex-wrap mb-4">
              <button onClick={() => setTendered(String(total))} className="px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-sm">Uang Pas</button>
              {[50000, 100000, 200000].map((v) => (
                <button key={v} onClick={() => setTendered(String(v))} className="px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-sm">
                  {rupiah(v)}
                </button>
              ))}
            </div>
            {cashValid && (
              <div className="text-sm text-gray-600 mb-4">Kembalian: <span className="font-semibold">{rupiah(Number(tendered) - total)}</span></div>
            )}
          </>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-gray-300 p-6 text-center mb-4">
            {qrisImage ? (
              <>
                <img src={qrisImage} alt="QRIS Kedai Rakdjat" className="h-64 w-64 object-contain mx-auto mb-1 bg-white" />
                <div className="text-xs text-gray-500 mb-3">KEDAI RAKDJAT · NMID ID1026487869343</div>
              </>
            ) : (
              <div className="font-semibold mb-1">QRIS Kedai Rakdjat</div>
            )}
            <p className="text-sm text-gray-500">Tunjukkan QRIS kedai ke pelanggan. Konfirmasi hanya setelah bukti pembayaran masuk di aplikasi merchant / soundbox.</p>
          </div>
        )}
        <button
          onClick={() => onConfirm(method, method === 'cash' ? Number(tendered) : total)}
          disabled={busy || (method === 'cash' && !cashValid)}
          className="w-full h-12 rounded-lg bg-primary text-white font-semibold disabled:opacity-40"
        >
          Konfirmasi Pembayaran
        </button>
      </div>
    </div>
  );
}
