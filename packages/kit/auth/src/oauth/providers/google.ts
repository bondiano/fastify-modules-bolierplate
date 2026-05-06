/**
 * Google OAuth 2.0 (OIDC) provider. Uses the standard endpoints + the
 * `openid email profile` scope set. Returns `email_verified: true`
 * for any account where Google has confirmed ownership (Gmail / SSO);
 * we use that signal to gate auto-link.
 *
 * https://developers.google.com/identity/protocols/oauth2/web-server
 */
import type {
  BuildAuthorizeUrlInput,
  ExchangeCodeInput,
  ExchangeCodeResult,
  OAuthProfile,
  OAuthProvider,
} from '../types.js';
import { appendQueryParams } from '../url.js';

export interface GoogleProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
}

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SCOPES = ['openid', 'email', 'profile'].join(' ');

export const createGoogleProvider = (
  options: GoogleProviderOptions,
): OAuthProvider => ({
  name: 'google',

  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
    return appendQueryParams(AUTHORIZE_URL, {
      client_id: options.clientId,
      response_type: 'code',
      scope: SCOPES,
      redirect_uri: input.redirectUri,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'select_account',
    });
  },

  async exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
    const body = new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    });
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Google token exchange failed: ${response.status} ${text}`,
      );
    }
    const json = (await response.json()) as {
      access_token?: string;
      id_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) {
      throw new Error('Google token exchange returned no access_token');
    }
    return {
      accessToken: json.access_token,
      ...(json.id_token ? { idToken: json.id_token } : {}),
      ...(json.expires_in ? { expiresIn: json.expires_in } : {}),
    };
  },

  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Google userinfo fetch failed: ${response.status}`);
    }
    const raw = (await response.json()) as Record<string, unknown>;
    const sub = typeof raw.sub === 'string' ? raw.sub : null;
    if (!sub) {
      throw new Error('Google userinfo missing `sub` claim');
    }
    return {
      providerUserId: sub,
      email: typeof raw.email === 'string' ? raw.email : null,
      emailVerified: raw.email_verified === true,
      displayName: typeof raw.name === 'string' ? raw.name : null,
      raw,
    };
  },
});
