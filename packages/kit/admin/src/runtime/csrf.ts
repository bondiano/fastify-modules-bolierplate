/**
 * Signed CSRF tokens for the admin panel. No session storage required:
 * the token is a self-describing `${userId}.${exp}.${nonce}.${hmac}`
 * string, and `verify` recomputes the HMAC with the shared secret to
 * decide whether to trust it.
 *
 * We can get away without per-session nonces because every admin route
 * already runs behind `verifyAdmin`; the CSRF check only has to make sure
 * a token submitted by user A cannot be replayed for user B, and that
 * tokens expire. Stateless HMAC covers both.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface CsrfOptions {
  readonly secret: string;
  /** Token lifetime in ms. Defaults to 2 hours. */
  readonly ttlMs?: number;
}

export interface CsrfService {
  /** Issue a token bound to the given user id (or `'anon'`). */
  issue(userId: string): string;
  /** Verify a token. Returns `false` on any error; never throws. */
  verify(token: string, userId: string): boolean;
}

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const NONCE_BYTES = 12;

const hmacHex = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload).digest('hex');

const safeEqualHex = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
};

export const createCsrfService = (opts: CsrfOptions): CsrfService => {
  if (!opts.secret || opts.secret.length === 0) {
    throw new Error('createCsrfService: secret must be a non-empty string');
  }
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const secret = opts.secret;

  const issue = (userId: string): string => {
    const exp = Date.now() + ttlMs;
    const nonce = randomBytes(NONCE_BYTES).toString('hex');
    const payload = `${userId}.${exp}.${nonce}`;
    const sig = hmacHex(secret, payload);
    return `${payload}.${sig}`;
  };

  const verify = (token: string, userId: string): boolean => {
    if (typeof token !== 'string' || token.length === 0) return false;
    const parts = token.split('.');
    if (parts.length !== 4) return false;
    const [tokUser, expString, nonce, sig] = parts;
    if (!tokUser || !expString || !nonce || !sig) return false;
    if (tokUser !== userId) return false;

    const exp = Number.parseInt(expString, 10);
    if (!Number.isFinite(exp)) return false;
    if (Date.now() > exp) return false;

    const expected = hmacHex(secret, `${tokUser}.${expString}.${nonce}`);
    return safeEqualHex(expected, sig);
  };

  return { issue, verify };
};
