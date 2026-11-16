import { rupiah } from '../../money';

export interface Success {
  id: number;
  queueNo?: number;
  customerName?: string;
  total: number;
  method: 'cash' | 'qris';
  change: number;
  /** Part of the cart is still unpaid (split payment). */
  partial?: boolean;
}

export default function SuccessModal({ success, printerMsg, onClose }: { success: Success; printerMsg: string; onClose: () => void }) {
  return (
    <div className="kr-backdrop fixed inset-0 bg-maroon-deep/50 backdrop-blur-sm grid place-items-center z-50">
      <div className="w-96 bg-white rounded-3xl p-8 text-center shadow-xl kr-modal">
        <div className="kr-check-ring kr-zoom w-14 h-14 rounded-full bg-green-100 text-green-700 grid place-items-center mx-auto mb-4">
          <svg viewBox="0 0 24 24" className="kr-check w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </div>
        <h2 className="font-display font-bold text-xl mb-1">Pembayaran Berhasil</h2>
        {printerMsg && <p role="alert" className="text-sm text-primary mb-2">{printerMsg}</p>}
        {success.queueNo && (
          <div className="my-3 rounded-2xl bg-surface py-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Nomor antrean</div>
            <div className="font-display font-bold text-4xl text-maroon tabular-nums">{success.queueNo}</div>
            {success.customerName && <div className="text-sm font-medium text-gray-700">{success.customerName}</div>}
          </div>
        )}
        <p className="text-sm text-gray-500 mb-4">Order #{success.id} · {success.method === 'cash' ? 'Tunai' : 'QRIS'}</p>
        <div className="kr-fade-up text-3xl font-display font-bold text-primary mb-1 tabular-nums" style={{ animationDelay: '0.25s' }}>{rupiah(success.total)}</div>
        {success.method === 'cash' && (
          <div className="text-sm text-gray-600 mb-4">Kembalian: <span className="font-semibold">{rupiah(success.change)}</span></div>
        )}
        {success.partial && <p className="text-sm text-gray-500 mb-2">Sebagian lunas. Sisa pesanan masih di keranjang dengan nomor antrean yang sama.</p>}
        <button onClick={onClose} className="w-full h-12 rounded-lg bg-primary text-white font-semibold mt-2">
          {success.partial ? 'Lanjutkan Sisa Pesanan' : 'Transaksi Baru'}
        </button>
      </div>
    </div>
  );
}
