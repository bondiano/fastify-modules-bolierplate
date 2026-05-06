import { describe, expect, it } from 'vitest';

import { createOAuthProviderRegistry } from './registry.js';

describe('createOAuthProviderRegistry', () => {
  it('returns an empty registry when no provider is configured', () => {
    const registry = createOAuthProviderRegistry({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
    });
    expect(registry.google).toBeUndefined();
    expect(registry.github).toBeUndefined();
  });

  it('instantiates Google when both id + secret are set', () => {
    const registry = createOAuthProviderRegistry({
      GOOGLE_CLIENT_ID: 'x',
      GOOGLE_CLIENT_SECRET: 'y',
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
    });
    expect(registry.google?.name).toBe('google');
    expect(registry.github).toBeUndefined();
  });

  it('instantiates GitHub when both id + secret are set', () => {
    const registry = createOAuthProviderRegistry({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GITHUB_CLIENT_ID: 'a',
      GITHUB_CLIENT_SECRET: 'b',
    });
    expect(registry.github?.name).toBe('github');
    expect(registry.google).toBeUndefined();
  });

  it('skips provider when only one of id/secret is set', () => {
    const registry = createOAuthProviderRegistry({
      GOOGLE_CLIENT_ID: 'x',
      GOOGLE_CLIENT_SECRET: undefined,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: 'b',
    });
    expect(registry.google).toBeUndefined();
    expect(registry.github).toBeUndefined();
  });
});
