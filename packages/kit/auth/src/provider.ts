import { asFunction, Lifetime } from 'awilix';

import type { ContainerProvider } from '@kit/core/di';

import { createAuthService } from './auth.service.js';
import { createPasswordHasher } from './password.js';
import type { TokenBlacklistStore, UserStore } from './stores.js';
import { createTokenService } from './tokens.js';

export interface AuthProviderOptions {
  /**
   * Resolve the `UserStore` from the DI cradle. Called lazily at resolution
   * time, so module-level repositories are available.
   *
   * @example
   * ```ts
   * resolveUserStore: ({ usersRepository }) => usersRepository.asUserStore()
   * ```
   */
  resolveUserStore: (deps: Dependencies) => UserStore;
  /**
   * Resolve the `TokenBlacklistStore` from the DI cradle.
   *
   * @example
   * ```ts
   * resolveTokenBlacklistStore: ({ redis }) => createTokenBlacklistService({ redis })
   * ```
   */
  resolveTokenBlacklistStore: (deps: Dependencies) => TokenBlacklistStore;
}

/**
 * Registers auth infrastructure services into the DI container:
 * `passwordHasher`, `tokenService`, `userStore`, `tokenBlacklistStore`,
 * and `authService`.
 *
 * Requires `config` (with auth fields) to already be in the cradle.
 */
export const authProvider =
  (options: AuthProviderOptions): ContainerProvider =>
  (container) => {
    container.register({
      passwordHasher: asFunction(createPasswordHasher, {
        lifetime: Lifetime.SINGLETON,
      }),
      tokenService: asFunction(createTokenService, {
        lifetime: Lifetime.SINGLETON,
      }),
      userStore: asFunction(options.resolveUserStore, {
        lifetime: Lifetime.SINGLETON,
      }),
      tokenBlacklistStore: asFunction(options.resolveTokenBlacklistStore, {
        lifetime: Lifetime.SINGLETON,
      }),
      authService: asFunction(createAuthService, {
        lifetime: Lifetime.SINGLETON,
      }),
    });
  };
