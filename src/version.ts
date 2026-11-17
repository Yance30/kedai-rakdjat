/** e.g. "Versi 1.0.0 · 17 Nov 2026 17.20 · a1b2c3d" — identifies exactly which build a tablet runs. */
export function versionLabel() {
  const built = new Date(Number(__BUILD_TIME__)).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `Versi ${__APP_VERSION__} · ${built} · ${__COMMIT__}`;
}
