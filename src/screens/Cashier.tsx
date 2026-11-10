import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { rupiah } from '../money';
import { buildBill, buildReceipt, buildTicket, connectPrinter, printBytes, printerAvailable, printerConnected } from '../printer';
import { pushAll } from '../sync';
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
  const [cat, setCat] = useState('Semua');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [paying, setPaying] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);
  const [printerName, setPrinterName] = useState('');
  const [printerMsg, setPrinterMsg] = useState('');
  const [loadedOrderId, setLoadedOrderId] = useState<number | null>(null);

  useEffect(() => {
    if (!tableId) {
      setLines([]);
      setLoadedOrderId(null);
      return;
    }
    setOrderType('dine_in');
    (async () => {
      const open = await db.orders.where('tableId').equals(tableId).and((o) => o.status === 'open').first();
      if (open?.id) {
        const items = await db.orderItems.where('orderId').equals(open.id).toArray();
        const prods = await db.products.toArray();
        setLines(
          items
            .map((it) => ({ product: prods.find((p) => p.id === it.productId)!, qty: it.qty }))
            .filter((l) => l.product),
        );
        setLoadedOrderId(open.id);
      } else {
        setLines([]);
        setLoadedOrderId(null);
      }
    })();
  }, [tableId]);

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

  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const service = Math.round(subtotal * serviceRate / 100);
  const tax = Math.round((subtotal + service) * 0.1);
  const total = subtotal + service + tax;

  function add(p: Product) {
    setLines((prev) => {
      const ex = prev.find((l) => l.product.id === p.id);
      return ex
        ? prev.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l))
        : [...prev, { product: p, qty: 1 }];
    });
  }

  function dec(id: number) {
    setLines((prev) =>
      prev
        .map((l) => (l.product.id === id ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0),
    );
  }

  async function confirmPay(method: 'cash' | 'qris', tendered: number) {
    const order: Order = {
      shiftId: shift.id!,
      status: 'paid',
      createdAt: Date.now(),
      subtotal,
      service,
      tax,
      total,
      orderType,
      ...(tableId ? { tableId } : {}),
    };
    const pay: Payment = {
      orderId: 0,
      shiftId: shift.id!,
      method,
      amount: total,
      tendered,
      change: tendered - total,
      createdAt: Date.now(),
    };
    const id = await db.transaction('rw', db.orders, db.orderItems, db.payments, db.meja, async () => {
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
      pay.orderId = orderId;
      await db.payments.add(pay);
      if (tableId) await db.meja.update(tableId, { status: 'cleaning' });
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
        await printBytes(buildReceipt({ ...order, id }, items, pay, staff.name));
        if (!tableId && orderType === 'dine_in') await printBytes(buildTicket({ ...order, id }, items));
      } catch {
        // gagal cetak tidak boleh memblokir pembayaran
      }
    }
    setSuccess({ id, total, method, change: tendered - total });
    setLines([]);
    setLoadedOrderId(null);
    setPaying(false);
    void pushAll();
  }

  async function saveOrder() {
    if (!tableId || lines.length === 0) return;
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
    const id = await db.transaction('rw', db.orders, db.orderItems, db.meja, async () => {
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
    void pushAll();
    onTableDone?.();
  }

  async function printBill() {
    if (lines.length === 0) return;
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
    const items: OrderItem[] = lines.map((l) => ({
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
    <div className="h-full flex">
      <div className="flex-1 min-w-0 p-6 overflow-y-auto">
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
                onClick={() => add(p)}
                className="mt-auto h-10 rounded-xl bg-primary/5 text-primary border border-primary/15 font-semibold hover:bg-primary hover:text-white"
              >
                + Tambah
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="w-80 shrink-0 bg-white border-l border-gray-200 flex flex-col p-4">
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
                onClick={() => setOrderType(t)}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm ${orderType === t ? 'bg-white text-primary font-semibold shadow-sm' : 'text-gray-500'}`}
              >
                {t === 'dine_in' ? 'Dine-in' : 'Takeaway'}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto space-y-3">
          {lines.length === 0 && <p className="text-sm text-gray-400">Belum ada item.</p>}
          {lines.map((l) => (
            <div key={l.product.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{l.product.name}</div>
                <div className="text-xs text-gray-500">{rupiah(l.product.price)}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => dec(l.product.id!)} className="w-7 h-7 rounded-md bg-gray-100 hover:bg-gray-200">−</button>
                <span className="w-5 text-center text-sm">{l.qty}</span>
                <button onClick={() => add(l.product)} className="w-7 h-7 rounded-md bg-primary text-white">+</button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-200 pt-3 mt-3 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{rupiah(subtotal)}</span></div>
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
              disabled={lines.length === 0}
              className="flex-1 h-11 rounded-lg bg-gray-800 text-white font-semibold disabled:opacity-40"
            >
              Simpan & ke Dapur
            </button>
            <button
              onClick={printBill}
              disabled={lines.length === 0 || !printerConnected()}
              title={!printerConnected() ? 'Hubungkan printer dulu' : 'Cetak bill sementara'}
              className="flex-1 h-11 rounded-lg bg-white border border-gray-300 text-gray-700 font-semibold disabled:opacity-40"
            >
              Bill Sementara
            </button>
          </div>
        )}
        <button
          onClick={() => setPaying(true)}
          disabled={lines.length === 0}
          className="mt-3 h-12 rounded-xl bg-gradient-to-r from-primary to-primary-bright text-white font-semibold shadow-md disabled:opacity-40"
        >
          Lanjut ke Pembayaran
        </button>
      </div>

      {paying && <PayModal total={total} qrisImage={getSetting('qris_image')} onCancel={() => setPaying(false)} onConfirm={confirmPay} />}

      {success && (
        <div className="fixed inset-0 bg-maroon-deep/50 backdrop-blur-sm grid place-items-center z-50">
          <div className="w-96 bg-white rounded-3xl p-8 text-center shadow-xl kr-zoom">
            <div className="w-14 h-14 rounded-full bg-green-100 text-green-700 grid place-items-center text-2xl mx-auto mb-4">✓</div>
            <h2 className="font-display font-bold text-xl mb-1">Pembayaran Berhasil</h2>
            <p className="text-sm text-gray-500 mb-4">Order #{success.id} · {success.method === 'cash' ? 'Tunai' : 'QRIS'}</p>
            <div className="text-3xl font-display font-bold text-primary mb-1 tabular-nums">{rupiah(success.total)}</div>
            {success.method === 'cash' && (
              <div className="text-sm text-gray-600 mb-4">Kembalian: <span className="font-semibold">{rupiah(success.change)}</span></div>
            )}
            <button onClick={() => { setSuccess(null); if (tableId) onTableDone?.(); }} className="w-full h-12 rounded-lg bg-primary text-white font-semibold mt-2">
              {tableId ? 'Kembali ke Denah Meja' : 'Transaksi Baru'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PayModal({
  total,
  qrisImage,
  onCancel,
  onConfirm,
}: {
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
              <img src={qrisImage} alt="QRIS Kedai Rakdjat" className="h-48 w-48 object-contain mx-auto mb-3" />
            ) : (
              <div className="font-semibold mb-1">QRIS Kedai Rakdjat</div>
            )}
            <p className="text-sm text-gray-500">Tunjukkan QRIS kedai ke pelanggan. Konfirmasi hanya setelah bukti pembayaran masuk di aplikasi merchant / soundbox.</p>
          </div>
        )}
        <button
          onClick={() => onConfirm(method, method === 'cash' ? Number(tendered) : total)}
          disabled={method === 'cash' && !cashValid}
          className="w-full h-12 rounded-lg bg-primary text-white font-semibold disabled:opacity-40"
        >
          Konfirmasi Pembayaran
        </button>
      </div>
    </div>
  );
}