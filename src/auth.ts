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
// This is an offline device lock, not a substitute for server-side authorization.
export async function authenticatePin(pin: string, ownerOnly = false): Promise<Staff> {
  if (checking) throw new Error('Pemeriksaan PIN sedang berjalan.');
  checking = true;
  try {
    const state = JSON.parse((await db.settings.get('pin_attempts'))?.value ?? '{"failures":0,"until":0}');
    if (Date.now() < state.until) throw new Error('Terlalu banyak percobaan. Tunggu satu menit.');
    const staff = ownerOnly ? await db.staff.where('role').equals('owner').toArray() : await db.staff.toArray();
    let match: Staff | undefined;
    for (const person of staff) if (await verifyPin(pin, person.pinHash)) { match = person; break; }
    if (!match) {
      const failures = state.failures + 1;
      await db.settings.put({ key: 'pin_attempts', value: JSON.stringify({ failures: failures >= 5 ? 0 : failures, until: failures >= 5 ? Date.now() + 60_000 : 0 }) });
      throw new Error('PIN salah.');
    }
    await db.settings.delete('pin_attempts');
    if (!match.pinHash.startsWith('pbkdf2$')) {
      match.mustChangePin = pin === '1111' || pin === '1234';
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
