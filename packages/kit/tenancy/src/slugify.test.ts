import { describe, expect, it } from 'vitest';

import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lowercases ascii input and replaces spaces with dashes', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });

  it('strips diacritics via NFKD normalization', () => {
    expect(slugify('Café Müller')).toBe('cafe-muller');
  });

  it('collapses any run of non-alphanumerics into a single dash', () => {
    expect(slugify('  hello___world  ')).toBe('hello-world');
    expect(slugify('hello!!!world')).toBe('hello-world');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('---acme---')).toBe('acme');
  });

  it('caps length at 63 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long)).toHaveLength(63);
  });

  it('returns the fallback "tenant" when input has no alphanumerics', () => {
    expect(slugify('   ')).toBe('tenant');
    expect(slugify('???')).toBe('tenant');
    expect(slugify('')).toBe('tenant');
  });
});
