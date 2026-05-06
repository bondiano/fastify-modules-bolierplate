import { describe, expect, it } from 'vitest';

import { deriveCodeChallenge, generateCodeVerifier } from './pkce.js';

describe('PKCE', () => {
  it('generates a base64url verifier 43 chars long', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toHaveLength(43);
    // RFC 7636: code_verifier charset is [A-Za-z0-9-._~]. Our impl is
    // base64url so we get [A-Za-z0-9-_].
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates a different verifier each call', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it('derives a stable challenge from a known verifier', () => {
    // Sample from RFC 7636 section 4.2
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = deriveCodeChallenge(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
