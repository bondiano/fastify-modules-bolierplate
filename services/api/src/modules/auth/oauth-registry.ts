/**
 * Service-side OAuth provider registry. Wires `@kit/auth/oauth`'s
 * `createOAuthProviderRegistry` against the active config so the
 * registry is a singleton in the cradle.
 */
import { config } from '#config.ts';
import {
  createOAuthProviderRegistry,
  type OAuthRegistry,
} from '@kit/auth/oauth';

declare global {
  interface Dependencies {
    oauthRegistry: OAuthRegistry;
  }
}

export const createKitOAuthRegistry = (): OAuthRegistry =>
  createOAuthProviderRegistry({
    GOOGLE_CLIENT_ID: config.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: config.GOOGLE_CLIENT_SECRET,
    GITHUB_CLIENT_ID: config.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: config.GITHUB_CLIENT_SECRET,
  });
