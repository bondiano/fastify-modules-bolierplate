/**
 * Crypto-strong token primitives shared by the password-reset / email-
 * verification / OTP flows. Pure functions, no IO.
 *
 * - URL-safe tokens are 256-bit base64url strings -- collision-free for
 *   our cardinality and safe to drop into a query string or path segment.
 * - Tokens are persisted as their SHA-256 hex digest. The DB never sees
 *   the raw value. This mirrors `@kit/tenancy`'s invitation token pattern
 *   and means a leaked DB row cannot redeem itself.
 * - `compareTokens` is timing-safe for equal-length strings (different
 *   lengths short-circuit before the timing-safe path -- a length leak
 *   is an acceptable tradeoff because token length is a constant).
 * - OTP codes are uniformly distributed across `0..999_999` via
 *   rejection sampling -- modulo bias would give the codes ending with
 *   `0..67` slightly higher probability.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Generate a fresh URL-safe token. 32 bytes (256 bits) of entropy is
 * enough to make the token unguessable for any practical attacker.
 */
export const generateUrlSafeToken = (bytes = 32): string =>
  randomBytes(bytes).toString('base64url');

/**
 * Hex-encoded SHA-256 of the input. Deterministic. Used for storing
 * token hashes in the DB (callers persist the hash, then look up by it).
 */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Constant-time string comparison. Returns false for unequal lengths
 * (no timing-safe path possible) and falls through to
 * `crypto.timingSafeEqual` otherwise.
 */
export const compareTokens = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/**
 * Cryptographically random 6-digit OTP. Uses rejection sampling on
 * `randomBytes(4)` so each code in `[000000, 999999]` is uniformly
 * probable. Worst-case retry rate is ~7e-3 per call (1 - 999_999_999 /
 * 4_294_967_296), so the loop is effectively O(1).
 */
export const generateOtpCode = (): string => {
  const max = Math.floor(0xff_ff_ff_ff / 1_000_000) * 1_000_000;
  let n: number;
  do {
    n = randomBytes(4).readUInt32BE(0);
  } while (n >= max);
  return (n % 1_000_000).toString().padStart(6, '0');
};
