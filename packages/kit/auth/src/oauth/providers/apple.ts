/**
 * Apple Sign-In provider scaffold. NOT IMPLEMENTED in v1 -- factory
 * throws so a missing config / accidental import is a loud error.
 *
 * Phase 3 (`P3.social.*`) will land:
 *  - signed-JWT `client_secret` generation (ES256, .p8 key, 6-month max
 *    lifetime; Redis cache with 80-day TTL + on-demand rotation);
 *  - email-on-first-grant handling (`sub` is stable; email arrives
 *    only on first authorization);
 *  - explicit failure when no email is available AND no existing
 *    identity row exists for the provider_user_id.
 */
import { OAuthProviderNotConfigured } from '../errors.js';
import type { OAuthProvider } from '../types.js';

export interface AppleProviderOptions {
  readonly clientId: string;
  readonly teamId: string;
  readonly keyId: string;
  /** Path to the `.p8` private key, or the key contents inline. */
  readonly privateKey: string;
}

export const createAppleProvider = (
  _options: AppleProviderOptions,
): OAuthProvider => {
  throw new OAuthProviderNotConfigured(
    'Apple OAuth is scaffolded but not implemented in v1. Land it in P3.social.*.',
  );
};
