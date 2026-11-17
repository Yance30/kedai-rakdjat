import { Component, type ErrorInfo, type ReactNode } from 'react';

/** After a deploy, an open app may ask for a code file that no longer exists; a reload fetches the new one. */
const isStaleChunk = (e: Error) => /dynamically imported module|Importing a module script failed|Loading chunk/i.test(e.message);

/**
 * Catches a crash while drawing a screen, so the counter sees a way out instead of a blank white page.
 * `page` keeps the sidebar usable: only the broken page is replaced, and switching tabs recovers.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; page?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tampilan gagal dimuat', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleChunk(error);
    return (
      <div className={`${this.props.page ? 'h-full' : 'h-full kr-shell'} grid place-items-center p-6`}>
        <div role="alert" className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 text-primary-bright grid place-items-center text-2xl font-bold mx-auto mb-3">!</div>
          <h1 className="font-bold text-lg mb-1">{stale ? 'Aplikasi baru saja diperbarui' : 'Terjadi kesalahan pada tampilan'}</h1>
          <p className="text-sm text-gray-600 mb-4">
            {stale ? 'Muat ulang untuk memakai versi terbaru.' : 'Data transaksi tetap aman tersimpan di tablet. Muat ulang untuk melanjutkan.'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button onClick={() => window.location.reload()} className="h-11 px-6 rounded-xl bg-primary text-white font-semibold">Muat ulang</button>
            {this.props.page && !stale && <button onClick={() => this.setState({ error: null })} className="h-11 px-6 rounded-xl bg-gray-100 font-semibold">Coba lagi</button>}
          </div>
          {!stale && <p className="text-[11px] text-gray-400 mt-4 break-words">Detail: {error.message}</p>}
        </div>
      </div>
    );
  }
}
