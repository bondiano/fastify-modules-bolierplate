import { describe, expect, it } from 'vitest';

import {
  buildUrlWithToken,
  escapeHtml,
  formatExpiresAt,
  sanitizeSubjectField,
} from './_helpers.js';

describe('escapeHtml', () => {
  it('escapes ampersand, angle brackets, quotes, backtick, equals', () => {
    expect(escapeHtml(`& < > " ' \` =`)).toBe(
      '&amp; &lt; &gt; &quot; &#39; &#96; &#61;',
    );
  });

  it('strips control characters (CR/LF + others)', () => {
    expect(escapeHtml('hello\nworld\r\t')).toBe('helloworld');
  });
});

describe('sanitizeSubjectField', () => {
  it('strips control characters and trims whitespace', () => {
    expect(sanitizeSubjectField('  hello\nworld  ')).toBe('helloworld');
  });
});

describe('formatExpiresAt', () => {
  it('returns the UTC string representation', () => {
    expect(formatExpiresAt(new Date('2026-05-06T12:00:00Z'))).toBe(
      'Wed, 06 May 2026 12:00:00 GMT',
    );
  });
});

describe('buildUrlWithToken', () => {
  it('appends ?token= when the URL has no query', () => {
    expect(buildUrlWithToken('https://example.com/x', 'abc')).toBe(
      'https://example.com/x?token=abc',
    );
  });

  it('appends &token= when the URL already has query params', () => {
    expect(buildUrlWithToken('https://example.com/x?a=b', 'abc')).toBe(
      'https://example.com/x?a=b&token=abc',
    );
  });

  it('reuses the trailing separator when URL ends with ?', () => {
    expect(buildUrlWithToken('https://example.com/x?', 'abc')).toBe(
      'https://example.com/x?token=abc',
    );
  });

  it('reuses the trailing separator when URL ends with &', () => {
    expect(buildUrlWithToken('https://example.com/x?a=b&', 'abc')).toBe(
      'https://example.com/x?a=b&token=abc',
    );
  });
});
