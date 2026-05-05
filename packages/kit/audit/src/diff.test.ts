import { describe, expect, it } from 'vitest';

import {
  computeDiff,
  DEFAULT_REDACT_PATTERNS,
  REDACTED,
  redact,
} from './diff.js';

describe('computeDiff', () => {
  describe('create (no before)', () => {
    it('emits every set field as { before: null, after: value }', () => {
      const result = computeDiff(null, { title: 'Hello', count: 5 });
      expect(result.diff).toEqual({
        title: { before: null, after: 'Hello' },
        count: { before: null, after: 5 },
      });
      expect(result.sensitive).toBe(false);
    });

    it('redacts default pattern matches', () => {
      const result = computeDiff(null, {
        email: 'a@b.com',
        password: 's3cret',
        apiKey: 'k-123',
      });
      expect(result.sensitive).toBe(true);
      expect(result.diff?.email).toEqual({ before: null, after: 'a@b.com' });
      expect(result.diff?.password).toEqual({ before: null, after: REDACTED });
      expect(result.diff?.apiKey).toEqual({ before: null, after: REDACTED });
    });
  });

  describe('delete (no after)', () => {
    it('emits every set field as { before: value, after: null }', () => {
      const result = computeDiff({ title: 'Old', count: 3 }, null);
      expect(result.diff).toEqual({
        title: { before: 'Old', after: null },
        count: { before: 3, after: null },
      });
      expect(result.sensitive).toBe(false);
    });

    it('still redacts on delete', () => {
      const result = computeDiff({ password: 'old' }, null);
      expect(result.sensitive).toBe(true);
      expect(result.diff?.password).toEqual({ before: REDACTED, after: null });
    });
  });

  describe('update (shallow per-field)', () => {
    it('returns null diff when nothing changed', () => {
      const result = computeDiff(
        { title: 'Same', count: 1 },
        { title: 'Same', count: 1 },
      );
      expect(result.diff).toBe(null);
      expect(result.sensitive).toBe(false);
    });

    it('emits only the changed fields', () => {
      const result = computeDiff(
        { title: 'Old', count: 1, role: 'admin' },
        { title: 'New', count: 1, role: 'admin' },
      );
      expect(result.diff).toEqual({
        title: { before: 'Old', after: 'New' },
      });
    });

    it('emits added fields with before=null', () => {
      const result = computeDiff(
        { title: 'A' },
        { title: 'A', extra: 'added' },
      );
      expect(result.diff).toEqual({
        extra: { before: null, after: 'added' },
      });
    });

    it('emits removed fields with after=null', () => {
      const result = computeDiff({ title: 'A', extra: 'gone' }, { title: 'A' });
      expect(result.diff).toEqual({
        extra: { before: 'gone', after: null },
      });
    });

    it('treats nested objects as always-changed (shallow diff)', () => {
      const before = { meta: { x: 1 } };
      const after = { meta: { x: 1 } };
      // Object.is on two distinct object refs is false even when keys match.
      const result = computeDiff(before, after);
      expect(result.diff).not.toBe(null);
      expect(result.diff?.meta).toBeDefined();
    });
  });

  describe('redaction surface', () => {
    it('matches every default pattern', () => {
      // Sanity check that the docs and the constant agree.
      const fields = [
        'password',
        'authToken',
        'API_SECRET',
        'api_key',
        'pwHash',
      ];
      for (const field of fields) {
        const matched = DEFAULT_REDACT_PATTERNS.some((p) => p.test(field));
        expect(matched, `expected ${field} to match a default pattern`).toBe(
          true,
        );
      }
    });

    it('honours per-resource sensitiveColumns override on top of patterns', () => {
      const result = computeDiff(
        null,
        { pin: '1234', mfaSeed: 'abc', email: 'a@b.com' },
        { sensitiveColumns: ['pin', 'mfaSeed'] },
      );
      expect(result.sensitive).toBe(true);
      expect(result.diff?.pin).toEqual({ before: null, after: REDACTED });
      expect(result.diff?.mfaSeed).toEqual({ before: null, after: REDACTED });
      expect(result.diff?.email).toEqual({ before: null, after: 'a@b.com' });
    });

    it('lets the caller replace the default pattern set entirely', () => {
      const result = computeDiff(
        null,
        { password: 'kept', mySecret: 'redacted' },
        { redactPatterns: [/^my/i] },
      );
      // password no longer matches because the default pattern set is replaced.
      expect(result.diff?.password).toEqual({ before: null, after: 'kept' });
      expect(result.diff?.mySecret).toEqual({ before: null, after: REDACTED });
    });
  });
});

describe('redact', () => {
  it('returns a new object with redacted fields replaced', () => {
    const input = { email: 'a@b.com', password: 's3cret' };
    const { value, sensitive } = redact(input);
    expect(sensitive).toBe(true);
    expect(value).toEqual({ email: 'a@b.com', password: REDACTED });
    expect(input.password).toBe('s3cret'); // not mutated
  });

  it('reports sensitive=false when nothing matched', () => {
    const { value, sensitive } = redact({ email: 'a@b.com', name: 'A' });
    expect(sensitive).toBe(false);
    expect(value).toEqual({ email: 'a@b.com', name: 'A' });
  });

  it('honours sensitiveColumns', () => {
    const { value, sensitive } = redact(
      { pin: '1234' },
      { sensitiveColumns: ['pin'] },
    );
    expect(sensitive).toBe(true);
    expect(value).toEqual({ pin: REDACTED });
  });
});
