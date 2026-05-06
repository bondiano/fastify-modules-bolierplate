import { describe, expect, it } from 'vitest';

import { signOAuthState, verifyOAuthState } from './state.js';
import type { OAuthStateClaims } from './types.js';
import { isReturnToAllowed } from './url.js';

const SECRET = 'a'.repeat(32);

const baseClaims: OAuthStateClaims = {
  nonce: 'n-1',
  returnTo: '/',
  codeVerifier: 'v-1',
  providerId: 'google',
};

describe('signOAuthState / verifyOAuthState', () => {
  it('round-trips a signed state', async () => {
    const token = await signOAuthState(baseClaims, SECRET);
    const verified = await verifyOAuthState(token, SECRET);
    expect(verified).toEqual(baseClaims);
  });

  it('round-trips with optional linkUserId', async () => {
    const token = await signOAuthState(
      { ...baseClaims, linkUserId: 'u-1' },
      SECRET,
    );
    const verified = await verifyOAuthState(token, SECRET);
    expect(verified?.linkUserId).toBe('u-1');
  });

  it('returns null on tampered signature', async () => {
    const token = await signOAuthState(baseClaims, SECRET);
    const tampered = token.slice(0, -4) + 'aaaa';
    expect(await verifyOAuthState(tampered, SECRET)).toBeNull();
  });

  it('returns null on wrong secret', async () => {
    const token = await signOAuthState(baseClaims, SECRET);
    const verified = await verifyOAuthState(token, 'b'.repeat(32));
    expect(verified).toBeNull();
  });

  it('returns null on malformed token', async () => {
    expect(await verifyOAuthState('not-a-jwt', SECRET)).toBeNull();
  });
});

describe('isReturnToAllowed', () => {
  const origin = 'https://app.example.com';

  it('allows root-relative paths', () => {
    expect(isReturnToAllowed('/', { origin })).toBe(true);
    expect(isReturnToAllowed('/dashboard', { origin })).toBe(true);
    expect(isReturnToAllowed('/dashboard?tab=billing', { origin })).toBe(true);
  });

  it('rejects protocol-relative URLs', () => {
    expect(isReturnToAllowed('//evil.com/x', { origin })).toBe(false);
  });

  it('allows absolute URLs on the same origin', () => {
    expect(
      isReturnToAllowed('https://app.example.com/dashboard', { origin }),
    ).toBe(true);
  });

  it('rejects absolute URLs on other origins', () => {
    expect(
      isReturnToAllowed('https://evil.example.com/dashboard', { origin }),
    ).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isReturnToAllowed('not a url', { origin })).toBe(false);
  });

  it('respects an explicit path allowlist when provided', () => {
    const opts = { origin, paths: ['/dashboard', '/billing'] as const };
    expect(isReturnToAllowed('/dashboard', opts)).toBe(true);
    expect(isReturnToAllowed('/dashboard?tab=x', opts)).toBe(true);
    expect(isReturnToAllowed('/secret', opts)).toBe(false);
  });
});
