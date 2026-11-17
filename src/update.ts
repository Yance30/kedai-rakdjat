import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

// A new deploy is downloaded in the background but only takes over after every tab is closed.
// Instead of making staff close the app twice, show a banner and let them reload when the counter is quiet.
const CHECK_EVERY = 30 * 60_000;

let ready = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

const updateSW = registerSW({
  onNeedRefresh() { ready = true; notify(); },
  onRegisteredSW(_url, registration) {
    // The cashier tablet stays open all day, so look for a new version now and then, not only at launch.
    if (registration) setInterval(() => { if (navigator.onLine) void registration.update().catch(() => undefined); }, CHECK_EVERY);
  },
});

export function useUpdateReady() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => ready);
}

/** Activates the waiting version and reloads. Carts are saved as drafts, so nothing in progress is lost. */
export function applyUpdate() {
  void updateSW(true);
}
