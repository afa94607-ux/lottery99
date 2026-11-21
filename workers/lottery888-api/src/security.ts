import crypto from 'node:crypto';

const SCRYPT_KEYLEN = 64;

/**
 * Hash a plaintext password using scrypt with a unique random 16-byte salt.
 * Format: scrypt$<saltHex>$<derivedKeyHex>
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/**
 * Constant-time verification of a plaintext password against a stored scrypt hash.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt$')) {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 3) {
    return false;
  }
  const [, salt, keyHex] = parts;
  if (!salt || !keyHex) {
    return false;
  }
  try {
    const expected = Buffer.from(keyHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    if (actual.length !== expected.length) {
      return false;
    }
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateUniqueCode(prefix: string): string {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}${rand}`;
}

export function getCryptoRandomLotteryNumber(): string {
  const n = crypto.randomInt(1, 100); // 1..99 inclusive
  return String(n).padStart(2, '0');
}

const CAMBODIA_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

export function formatCambodiaDateYmd(input: Date | number = Date.now()): string {
  const ms = typeof input === 'number' ? input : input.getTime();
  const safeMs = Number.isFinite(ms) ? ms : Date.now();
  const kh = new Date(safeMs + CAMBODIA_UTC_OFFSET_MS);
  const y = kh.getUTCFullYear();
  const m = String(kh.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kh.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateTimeNow(now: Date | number = new Date()): {
  dateYmd: string;
  dateDmy: string;
  timeHm: string;
  dateTimeYmdHm: string;
} {
  const ms = typeof now === 'number' ? now : now.getTime();
  const safeMs = Number.isFinite(ms) ? ms : Date.now();
  const kh = new Date(safeMs + CAMBODIA_UTC_OFFSET_MS);
  const y = kh.getUTCFullYear();
  const m = String(kh.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kh.getUTCDate()).padStart(2, '0');
  const hh = String(kh.getUTCHours()).padStart(2, '0');
  const mm = String(kh.getUTCMinutes()).padStart(2, '0');
  return {
    dateYmd: `${y}-${m}-${d}`,
    dateDmy: `${d}-${m}-${y}`,
    timeHm: `${hh}:${mm}`,
    dateTimeYmdHm: `${y}-${m}-${d} ${hh}:${mm}`,
  };
}
