import { describe, expect, it, vi } from 'vitest';

import { createCsrfService } from './csrf.js';

describe('createCsrfService', () => {
  const secret = 'this-is-a-test-secret-long-enough';

  it('round-trips a valid token', () => {
    const svc = createCsrfService({ secret });
    const token = svc.issue('user-1');
    expect(svc.verify(token, 'user-1')).toBe(true);
  });

  it('rejects a token for a different user', () => {
    const svc = createCsrfService({ secret });
    const token = svc.issue('user-1');
    expect(svc.verify(token, 'user-2')).toBe(false);
  });

  it('rejects an expired token', () => {
    const svc = createCsrfService({ secret, ttlMs: 10 });
    const token = svc.issue('user-1');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 1000);
      expect(svc.verify(token, 'user-1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed tokens without throwing', () => {
    const svc = createCsrfService({ secret });
    expect(svc.verify('', 'user-1')).toBe(false);
    expect(svc.verify('totally.not.a.token', 'user-1')).toBe(false);
    expect(svc.verify('a.b.c', 'user-1')).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const svc = createCsrfService({ secret });
    const token = svc.issue('user-1');
    const other = createCsrfService({ secret: 'another-secret-entirely' });
    expect(other.verify(token, 'user-1')).toBe(false);
  });

  it('throws if secret is empty', () => {
    expect(() => createCsrfService({ secret: '' })).toThrow();
  });
});
