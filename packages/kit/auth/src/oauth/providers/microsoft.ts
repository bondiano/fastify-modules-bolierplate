/**
 * Microsoft Identity Platform (v2) scaffold. NOT IMPLEMENTED in v1 --
 * factory throws so a missing config / accidental import is a loud
 * error.
 *
 * Phase 3 (`P3.social.*`) will land:
 *  - tenant routing (`common` / `consumers` / `<tenant-id>`);
 *  - `xms_edov` claim verification for email_verified signal;
 *  - PKCE (already required by Microsoft v2 endpoint).
 */
import { OAuthProviderNotConfigured } from '../errors.js';
import type { OAuthProvider } from '../types.js';

export interface MicrosoftProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  /** `common` (work + personal), `consumers` (personal only), or a
   * specific Azure AD tenant id. */
  readonly tenant: string;
}

export const createMicrosoftProvider = (
  _options: MicrosoftProviderOptions,
): OAuthProvider => {
  throw new OAuthProviderNotConfigured(
    'Microsoft OAuth is scaffolded but not implemented in v1. Land it in P3.social.*.',
  );
};
