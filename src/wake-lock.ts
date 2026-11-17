import { useEffect } from 'react';

/**
 * Keeps the tablet screen on while `active` (cashier and KDS tablets must not dim between orders).
 * Browsers drop the lock whenever the page is hidden, so it is requested again on return.
 * Unsupported browsers or a denied request simply leave the normal screen timeout in place.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (stopped || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (stopped) void next.release();
        else lock = next;
      } catch { /* battery saver or permission policy: keep the normal timeout */ }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
