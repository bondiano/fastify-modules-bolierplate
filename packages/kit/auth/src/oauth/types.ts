/**
 * OAuth provider port. Adapters in `oauth/providers/{google,github,apple,
 * microsoft}.ts` implement this; the auth service consumes the same
 * interface regardless of which provider is configured.
 *
 * Authorization Code + PKCE per RFC 9700 (Jan 2025 BCP) -- PKCE is
 * required for ALL clients including confidential server-side ones.
 * State is a signed JWT carrying `nonce`, `returnTo`, `codeVerifier`,
 * and `providerId` (10-min exp). No cookies -- sidesteps SameSite
 * issues on cross-site OAuth redirect.
 */

export type OAuthProviderName = 'google' | 'github' | 'apple' | 'microsoft';

export interface OAuthProfile {
  /** Stable id from the provider (e.g. Google `sub`, GitHub numeric `id`,
   * Apple `sub`). NOT the email -- email can change. */
  readonly providerUserId: string;
  /** Email at the time of authorization. Apple omits this on re-grants;
   * the callback handler treats null as "look up by providerUserId". */
  readonly email: string | null;
  /** Trust signal from the provider. We auto-link colliding local users
   * only when both sides are verified -- prevents account takeover via
   * unverified email. */
  readonly emailVerified: boolean;
  readonly displayName: string | null;
  /** Raw profile snapshot persisted on `user_identities.raw_profile`. */
  readonly raw: Record<string, unknown>;
}

export interface BuildAuthorizeUrlInput {
  readonly state: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
  /** Optional `nonce` claim value to include in the authorize URL --
   * Apple/OIDC providers verify it on the ID token. */
  readonly nonce?: string;
}

export interface ExchangeCodeInput {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

export interface ExchangeCodeResult {
  readonly accessToken: string;
  /** OIDC providers (Google, Apple, Microsoft) include an ID token
   * carrying the `sub` claim. Used for PKCE-verified user identity. */
  readonly idToken?: string;
  readonly expiresIn?: number;
}

export interface OAuthProvider {
  readonly name: OAuthProviderName;
  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string;
  exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult>;
  fetchProfile(accessToken: string, idToken?: string): Promise<OAuthProfile>;
}

export interface OAuthStateClaims {
  readonly nonce: string;
  readonly returnTo: string;
  readonly codeVerifier: string;
  readonly providerId: OAuthProviderName;
  /** When set, the callback links the resulting identity to this user
   * id instead of creating a new account. Used by `POST /auth/oauth/:p/link`. */
  readonly linkUserId?: string;
}
