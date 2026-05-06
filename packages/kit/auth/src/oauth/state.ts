/**
 * OAuth state parameter -- a signed JWT carrying `nonce`, `returnTo`,
 * `codeVerifier`, and `providerId`. 10-min exp. Sent as the URL `state`
 * param; verified on callback.
 *
 * Why no cookie: cross-site OAuth redirects collide with `SameSite=Strict`
 * (cookie dropped) and `SameSite=Lax` (cookie included on top-level GET
 * but `Secure` is mandatory in production). A signed JWT in the URL is
 * stateless, identical across browsers, and immune to those edge cases.
 */
import * as jose from 'jose';

import type { OAuthStateClaims } from './types.js';

const STATE_TTL_SECONDS = 600;

export const signOAuthState = async (
  claims: OAuthStateClaims,
  secret: string,
): Promise<string> => {
  const key = new TextEncoder().encode(secret);
  return await new jose.SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(key);
};

export const verifyOAuthState = async (
  token: string,
  secret: string,
): Promise<OAuthStateClaims | null> => {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jose.jwtVerify(token, key);
    if (!isOAuthStateClaims(payload)) return null;
    return {
      nonce: payload.nonce,
      returnTo: payload.returnTo,
      codeVerifier: payload.codeVerifier,
      providerId: payload.providerId,
      ...(payload.linkUserId ? { linkUserId: payload.linkUserId } : {}),
    };
  } catch {
    return null;
  }
};

const isOAuthStateClaims = (
  payload: unknown,
): payload is OAuthStateClaims & jose.JWTPayload => {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.nonce === 'string' &&
    typeof p.returnTo === 'string' &&
    typeof p.codeVerifier === 'string' &&
    typeof p.providerId === 'string' &&
    ['google', 'github', 'apple', 'microsoft'].includes(p.providerId) &&
    (p.linkUserId === undefined || typeof p.linkUserId === 'string')
  );
};
