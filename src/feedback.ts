// Tactile feedback. Best-effort: unsupported devices simply ignore it.

/** Short vibration on Android tablets/phones. iOS Safari and desktops ignore it. */
export function haptic(pattern: number | number[] = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}
