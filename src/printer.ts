import type { Order, OrderItem, Payment } from './types';
import { rupiah } from './money';

let device: BluetoothDevice | null = null;
let ch: BluetoothRemoteGATTCharacteristic | null = null;

const SVC = [
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
];

export function printerAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export function printerConnected() {
  return !!device?.gatt?.connected && !!ch;
}

export async function connectPrinter(): Promise<string> {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth tidak tersedia di browser ini. Pakai Chrome di Android/PC.');
  device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SVC });
  const server = await device.gatt!.connect();
  const services = await server.getPrimaryServices();
  for (const s of services) {
    const chars = await s.getCharacteristics();
    const w = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
    if (w) {
      ch = w;
      break;
    }
  }
  if (!ch) throw new Error('Printer tidak memiliki karakteristik tulis yang cocok.');
  device.addEventListener('gattserverdisconnected', () => {
    ch = null;
  });
  return device.name ?? 'Printer';
}

const enc = new TextEncoder();
const W = 32;

function line(b: number[], text: string) {
  b.push(...enc.encode(text + '\n'));
}

function row(b: number[], l: string, r: string) {
  const space = Math.max(1, W - l.length - r.length);
  line(b, l + ' '.repeat(space) + r);
}

export function buildReceipt(o: Order, items: OrderItem[], pay: Payment, cashier: string): Uint8Array {
  const b: number[] = [0x1b, 0x40, 0x1b, 0x61, 0x01];
  line(b, 'KEDAI RAKDJAT');
  line(b, 'Main Branch');
  line(b, '--------------------------------');
  b.push(0x1b, 0x61, 0x00);
  line(b, `Order #${o.id} ${o.orderType === 'dine_in' ? 'Dine-in' : 'Takeaway'}`);
  line(b, new Date(o.createdAt).toLocaleString('id-ID'));
  line(b, `Kasir: ${cashier}`);
  line(b, '--------------------------------');
  for (const it of items) {
    line(b, it.name);
    row(b, `  ${it.qty} x ${rupiah(it.price)}`, rupiah(it.qty * it.price));
  }
  line(b, '--------------------------------');
  row(b, 'Subtotal', rupiah(o.subtotal));
  if (o.service) row(b, 'Service', rupiah(o.service));
  row(b, 'Pajak 10%', rupiah(o.tax));
  row(b, 'TOTAL', rupiah(o.total));
  row(b, pay.method === 'cash' ? 'Tunai' : 'QRIS', rupiah(pay.tendered));
  if (pay.method === 'cash') row(b, 'Kembali', rupiah(pay.change));
  b.push(0x1b, 0x61, 0x01);
  line(b, 'Terima kasih!');
  line(b, '');
  b.push(0x1d, 0x56, 0x42, 0x00);
  return new Uint8Array(b);
}

export function buildTicket(o: Order, items: OrderItem[], tableLabel?: string): Uint8Array {
  const b: number[] = [0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01];
  line(b, `DAPUR - Order #${o.id}`);
  b.push(0x1b, 0x45, 0x00);
  if (tableLabel) line(b, tableLabel);
  line(b, new Date(o.createdAt).toLocaleTimeString('id-ID'));
  line(b, '--------------------------------');
  b.push(0x1b, 0x61, 0x00);
  for (const it of items) {
    line(b, `${it.qty} x ${it.name}`);
  }
  line(b, '');
  b.push(0x1d, 0x56, 0x42, 0x00);
  return new Uint8Array(b);
}

export function buildBill(o: Order, items: OrderItem[], cashier: string, tableLabel?: string): Uint8Array {
  const b: number[] = [0x1b, 0x40, 0x1b, 0x61, 0x01];
  line(b, 'KEDAI RAKDJAT');
  line(b, 'BILL SEMENTARA');
  line(b, '--------------------------------');
  b.push(0x1b, 0x61, 0x00);
  if (tableLabel) line(b, tableLabel);
  line(b, new Date(o.createdAt).toLocaleString('id-ID'));
  line(b, `Kasir: ${cashier}`);
  line(b, '--------------------------------');
  for (const it of items) {
    line(b, it.name);
    row(b, `  ${it.qty} x ${rupiah(it.price)}`, rupiah(it.qty * it.price));
  }
  line(b, '--------------------------------');
  row(b, 'Subtotal', rupiah(o.subtotal));
  if (o.service) row(b, 'Service', rupiah(o.service));
  row(b, 'Pajak 10%', rupiah(o.tax));
  row(b, 'TOTAL', rupiah(o.total));
  b.push(0x1b, 0x61, 0x01);
  line(b, 'Belum termasuk pembayaran');
  line(b, '');
  b.push(0x1d, 0x56, 0x42, 0x00);
  return new Uint8Array(b);
}

export async function printBytes(data: Uint8Array) {
  if (!ch) throw new Error('Printer belum tersambung.');
  const CHUNK = 100;
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.slice(i, i + CHUNK);
    if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(slice);
    else await ch.writeValue(slice);
  }
}