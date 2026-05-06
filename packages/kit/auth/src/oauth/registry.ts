/**
 * OAuth provider registry. Selects the active set of providers based on
 * which `*_CLIENT_ID` env vars are present and instantiates each. The
 * registry is a `Record<OAuthProviderName, OAuthProvider | undefined>`
 * so callers can probe with `registry[name]` and surface
 * `OAuthProviderNotConfigured` when missing.
 */
import { createGitHubProvider } from './providers/github.js';
import { createGoogleProvider } from './providers/google.js';
import type { OAuthProvider, OAuthProviderName } from './types.js';

export interface OAuthRegistryConfig {
  readonly GOOGLE_CLIENT_ID: string | undefined;
  readonly GOOGLE_CLIENT_SECRET: string | undefined;
  readonly GITHUB_CLIENT_ID: string | undefined;
  readonly GITHUB_CLIENT_SECRET: string | undefined;
}

export type OAuthRegistry = Partial<Record<OAuthProviderName, OAuthProvider>>;

export const createOAuthProviderRegistry = (
  config: OAuthRegistryConfig,
): OAuthRegistry => {
  const registry: OAuthRegistry = {};
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
    registry.google = createGoogleProvider({
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
    });
  }
  if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
    registry.github = createGitHubProvider({
      clientId: config.GITHUB_CLIENT_ID,
      clientSecret: config.GITHUB_CLIENT_SECRET,
    });
  }
  // Apple + Microsoft scaffolded only; the factories throw on
  // construction so they're never instantiated in v1.
  return registry;
};
