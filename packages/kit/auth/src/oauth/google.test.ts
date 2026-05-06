import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGoogleProvider } from './providers/google.js';

const provider = createGoogleProvider({
  clientId: 'cid',
  clientSecret: 'csec',
});

describe('createGoogleProvider', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('builds an authorize URL with PKCE + scopes', () => {
    const url = provider.buildAuthorizeUrl({
      state: 'st',
      codeChallenge: 'ch',
      redirectUri: 'https://app.example/cb',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(parsed.searchParams.get('client_id')).toBe('cid');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('code_challenge')).toBe('ch');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe('st');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://app.example/cb',
    );
  });

  it('exchanges code with PKCE verifier', async () => {
    globalThis.fetch = vi.fn(async () => {
      return Response.json(
        {
          access_token: 'at',
          id_token: 'idt',
          expires_in: 3600,
        },
        { headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof globalThis.fetch;
    const tokens = await provider.exchangeCode({
      code: 'c',
      codeVerifier: 'v',
      redirectUri: 'https://app.example/cb',
    });
    expect(tokens.accessToken).toBe('at');
    expect(tokens.idToken).toBe('idt');
    expect(tokens.expiresIn).toBe(3600);
  });

  it('normalizes userinfo into OAuthProfile', async () => {
    globalThis.fetch = vi.fn(async () => {
      return Response.json(
        {
          sub: 'g-1',
          email: 'alex@example.com',
          email_verified: true,
          name: 'Alex',
        },
        { headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof globalThis.fetch;
    const profile = await provider.fetchProfile('at');
    expect(profile.providerUserId).toBe('g-1');
    expect(profile.email).toBe('alex@example.com');
    expect(profile.emailVerified).toBe(true);
    expect(profile.displayName).toBe('Alex');
  });

  it('throws when userinfo lacks `sub`', async () => {
    globalThis.fetch = vi.fn(async () => {
      return Response.json(
        { email: 'a@b' },
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof globalThis.fetch;
    await expect(provider.fetchProfile('at')).rejects.toThrow(/missing/i);
  });
});
