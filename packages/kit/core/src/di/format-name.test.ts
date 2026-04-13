import { describe, it, expect } from 'vitest';

import { formatName } from './format-name.js';

describe('formatName', () => {
  it('converts single-word repository filename', () => {
    expect(formatName('users.repository')).toBe('usersRepository');
  });

  it('converts kebab-case to camelCase', () => {
    expect(formatName('merchant-mids.repository')).toBe(
      'merchantMidsRepository',
    );
  });

  it('drops "async" segment', () => {
    expect(formatName('tokens.async-service')).toBe('tokensService');
  });

  it('handles client suffix', () => {
    expect(formatName('api.client')).toBe('apiClient');
  });

  it('handles mapper suffix', () => {
    expect(formatName('users.mapper')).toBe('usersMapper');
  });
});
