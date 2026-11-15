// Tactile and audible feedback. Every call is best-effort: unsupported devices simply stay silent.

/** Short vibration on Android tablets/phones. iOS Safari and desktops ignore it. */
export function haptic(pattern: number | number[] = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

let ctx: AudioContext | null = null;

/**
 * Browsers only allow audio after a user gesture, so call this from a click handler
 * (e.g. the KDS "sound on" button) before relying on chime().
 */
export async function unlockAudio(): Promise<boolean> {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

/** Two-tone bell for a new kitchen ticket, synthesised so no audio file is needed offline. */
export function chime() {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = now + i * 0.18;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(start);
    osc.stop(start + 0.65);
  });
}
