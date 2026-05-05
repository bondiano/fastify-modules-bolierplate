import { describe, expect, it } from 'vitest';

import {
  compareTokens,
  generateOtpCode,
  generateUrlSafeToken,
  hashToken,
} from './token-utilities.js';

describe('generateUrlSafeToken', () => {
  it('produces base64url-encoded strings of the expected length', () => {
    const token = generateUrlSafeToken(32);
    // base64url(32 bytes) = 43 chars, no padding
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('returns distinct values across calls (entropy smoke check)', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      seen.add(generateUrlSafeToken());
    }
    expect(seen.size).toBe(100);
  });

  it('honours the bytes argument', () => {
    const token = generateUrlSafeToken(16);
    // base64url(16 bytes) = 22 chars, no padding
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('hashToken', () => {
  it('is deterministic', () => {
    const a = hashToken('hello');
    const b = hashToken('hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('matches a known SHA-256 value (sanity)', () => {
    // sha256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hashToken('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('compareTokens', () => {
  it('returns true for equal strings', () => {
    expect(compareTokens('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(compareTokens('abc', 'abd')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(compareTokens('abc', 'abcd')).toBe(false);
    expect(compareTokens('abcd', 'abc')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(compareTokens('', '')).toBe(true);
  });
});

describe('generateOtpCode', () => {
  it('always produces a 6-digit zero-padded string', () => {
    for (let index = 0; index < 1000; index += 1) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('returns distinct values across calls (entropy smoke check)', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      seen.add(generateOtpCode());
    }
    // Birthday-paradox-safe: 200 samples from 10^6 should rarely collide.
    expect(seen.size).toBeGreaterThan(195);
  });
});
