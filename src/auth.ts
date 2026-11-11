import { db, hashPin as legacyHash } from './db';
import type { Staff } from './types';

const iterations = 600_000;
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
async function derive(pin: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)));
}
export async function secureHash(pin: string) {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN harus 4–6 angka.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${hex(salt)}$${await derive(pin, salt)}`;
}
export async function verifyPin(pin: string, stored: string) {
  if (!stored.startsWith('pbkdf2$')) return legacyHash(pin) === stored;
  const [, salt, expected] = stored.split('$');
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const actual = await derive(pin, Uint8Array.from(salt.match(/../g)!, s => parseInt(s, 16)));
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
let checking = false;

// Escalating lockout: every 5 wrong PINs lock the device for longer. The level only decays after a quiet
// period, so a correct login with one's own PIN cannot be used to reset the clock while guessing another's.
const MAX_FAILURES = 5;
const LOCK_STEPS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const LEVEL_RESET_AFTER = 6 * 60 * 60_000;
const LOG_LIMIT = 50;
interface PinState { failures: number; level: number; until: number; lastLock: number }
export interface PinLockEvent { at: number; until: number; level: number; staffId?: number; ownerOnly: boolean }

async function readPinState(): Promise<PinState> {
  try {
    const raw = JSON.parse((await db.settings.get('pin_attempts'))?.value ?? '{}');
    return { failures: raw.failures | 0, level: raw.level | 0, until: Number(raw.until) || 0, lastLock: Number(raw.lastLock) || 0 };
  } catch { return { failures: 0, level: 0, until: 0, lastLock: 0 }; }
}
export async function pinLockLog(): Promise<PinLockEvent[]> {
  try { return JSON.parse((await db.settings.get('pin_lock_log'))?.value ?? '[]'); } catch { return []; }
}
const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

async function recordFailure(state: PinState, staffId: number | undefined, ownerOnly: boolean) {
  const now = Date.now();
  const next: PinState = { ...state, failures: state.failures + 1 };
  let locked: PinLockEvent | undefined;
  if (next.failures >= MAX_FAILURES) {
    const level = (now - state.lastLock > LEVEL_RESET_AFTER ? 0 : state.level) + 1;
    const until = now + LOCK_STEPS[Math.min(level, LOCK_STEPS.length) - 1];
    Object.assign(next, { failures: 0, level, until, lastLock: now });
    locked = { at: now, until, level, staffId, ownerOnly };
  }
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key: 'pin_attempts', value: JSON.stringify(next) });
    if (locked) await db.settings.put({ key: 'pin_lock_log', value: JSON.stringify([locked, ...await pinLockLog()].slice(0, LOG_LIMIT)) });
  });
  return locked;
}

// This is an offline device lock, not a substitute for server-side authorization.
/**
 * Each PBKDF2 check costs ~0.5–1 s on a mid-range tablet, so pass `staffId` (staff picked on the
 * login screen) to verify a single hash instead of trying every staff member in turn.
 */
export async function authenticatePin(pin: string, ownerOnly = false, staffId?: number): Promise<Staff> {
  if (checking) throw new Error('Pemeriksaan PIN sedang berjalan.');
  checking = true;
  try {
    const state = await readPinState();
    if (Date.now() < state.until) throw new Error(`Terlalu banyak percobaan. Tunggu ${minutes(state.until - Date.now())} menit lagi.`);
    const pool = staffId !== undefined ? [await db.staff.get(staffId)].filter((s): s is Staff => !!s)
      : ownerOnly ? await db.staff.where('role').equals('owner').toArray() : await db.staff.toArray();
    const staff = ownerOnly ? pool.filter(s => s.role === 'owner') : pool;
    let match: Staff | undefined;
    for (const person of staff) if (await verifyPin(pin, person.pinHash)) { match = person; break; }
    if (!match) {
      const locked = await recordFailure(state, staffId, ownerOnly);
      throw new Error(locked ? `PIN salah. Terlalu banyak percobaan, perangkat dikunci ${minutes(locked.until - locked.at)} menit.` : `PIN salah. Sisa ${MAX_FAILURES - state.failures - 1} percobaan.`);
    }
    if (state.failures) await db.settings.put({ key: 'pin_attempts', value: JSON.stringify({ ...state, failures: 0 }) });
    if (!match.pinHash.startsWith('pbkdf2$')) {
      // Keep a forced change from a restored legacy backup; demo PINs always must change.
      match.mustChangePin = !!match.mustChangePin || pin === '1111' || pin === '1234';
      match.pinHash = await secureHash(pin);
      await db.staff.put(match);
    }
    if (ownerOnly && match.mustChangePin) throw new Error('Owner harus login dan mengganti PIN demo terlebih dahulu.');
    return match;
  } finally { checking = false; }
}

export async function changePin(staffId: number, pin: string) {
  if (pin === '1111' || pin === '1234') throw new Error('Gunakan PIN selain PIN demo.');
  for (const person of await db.staff.toArray()) {
    if (person.id !== staffId && await verifyPin(pin, person.pinHash)) throw new Error('PIN sudah digunakan staf lain.');
  }
  await db.staff.update(staffId, { pinHash: await secureHash(pin), mustChangePin: false });
}
