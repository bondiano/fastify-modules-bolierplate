import { asFunction, asValue, Lifetime } from 'awilix';

import type { ContainerProvider } from '@kit/core/di';

import { createAbilityFactory, type DefineAbilities } from './ability.js';

export interface AuthzProviderOptions {
  /** Module-supplied ability definers, executed in order. */
  readonly definers: readonly DefineAbilities[];
  /**
   * Role name that gets a blanket `manage all` grant. Set to `null` to
   * disable. Defaults to `'admin'`.
   */
  readonly adminRole?: string | null;
}

/**
 * Registers `abilityDefiners` and `abilityFactory` into the DI container.
 */
export const authzProvider =
  (options: AuthzProviderOptions): ContainerProvider =>
  (container) => {
    const { definers } = options;
    const factoryOptions =
      'adminRole' in options
        ? { definers, adminRole: options.adminRole }
        : { definers };

    container.register({
      abilityDefiners: asValue(definers),
      abilityFactory: asFunction(() => createAbilityFactory(factoryOptions), {
        lifetime: Lifetime.SINGLETON,
      }),
    });
  };
