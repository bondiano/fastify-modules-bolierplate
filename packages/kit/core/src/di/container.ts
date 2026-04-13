import { glob } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { diContainer } from '@fastify/awilix';
import { asFunction, asValue, Lifetime, type AwilixContainer } from 'awilix';

import type { Logger } from '../logger/index.js';

import { formatName } from './format-name.js';
import type { ContainerProvider } from './types.js';

export interface CreateContainerOptions {
  logger: Logger;
  config: Record<string, unknown>;
  /**
   * Absolute glob patterns for convention-based auto-loading.
   * Files matching `*.{repository,service,mapper,client}.{js,ts}` will be
   * registered as singleton functions under camelCased cradle keys.
   */
  modulesGlobs?: string[];
  /**
   * Extra values registered in the container before module auto-loading.
   * Useful for infra dependencies like a db data source.
   */
  extraValues?: Record<string, unknown>;
  /**
   * Kit package providers that register infrastructure services into the
   * container. Executed after `extraValues` and `modulesGlobs` loading,
   * in the order given.
   *
   * @example
   * ```ts
   * providers: [
   *   dbProvider(),
   *   authProvider({ resolveUserStore: ... }),
   *   authzProvider({ definers: [...] }),
   * ]
   * ```
   */
  providers?: ContainerProvider[];
}

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === 'function';

/**
 * Resolve the factory function from an ESM module. Supports three shapes:
 *   1. `export default createX`  (standard Awilix convention)
 *   2. `export const createX = ...` (no default; first function export)
 *   3. Both present -- prefer default
 */
const resolveFactory = (
  module_: Record<string, unknown>,
): ((...args: never[]) => unknown) | undefined => {
  if (module_['default'] && isFunction(module_['default'])) {
    return module_['default'];
  }
  for (const key of Object.keys(module_)) {
    if (key === 'default') continue;
    if (isFunction(module_[key])) return module_[key];
  }
  return undefined;
};

/**
 * Load ESM modules matching glob patterns and register their factory
 * functions in the Awilix container. Unlike Awilix's built-in
 * `loadModules`, this handles named exports (not only default exports)
 * and works with `.ts` files under `--experimental-strip-types`.
 */
const loadModulesFromGlobs = async (
  container: AwilixContainer,
  globs: readonly string[],
  logger: Logger,
): Promise<void> => {
  for (const pattern of globs) {
    for await (const entry of glob(pattern)) {
      const filePath = typeof entry === 'string' ? entry : String(entry);
      const baseName = path.basename(filePath).replace(/\.[^.]+$/, '');
      const name = formatName(baseName);

      try {
        const module_ = (await import(pathToFileURL(filePath).href)) as Record<
          string,
          unknown
        >;
        const factory = resolveFactory(module_);
        if (!factory) {
          logger.debug(
            { filePath },
            `@kit/core/di: no callable export in ${baseName}, skipping`,
          );
          continue;
        }
        container.register(
          name,
          asFunction(factory, { lifetime: Lifetime.SINGLETON }),
        );
      } catch (error) {
        logger.error(
          { err: error, filePath },
          `@kit/core/di: failed to load module ${baseName}`,
        );
      }
    }
  }
};

export const createContainer = async ({
  logger,
  config,
  modulesGlobs = [],
  extraValues = {},
  providers = [],
}: CreateContainerOptions): Promise<AwilixContainer> => {
  const container = diContainer;

  container.register({
    logger: asValue(logger),
    config: asValue(config),
  });

  for (const [key, value] of Object.entries(extraValues)) {
    container.register(key, asValue(value));
  }

  if (modulesGlobs.length > 0) {
    await loadModulesFromGlobs(container, modulesGlobs, logger);
  }

  for (const provider of providers) {
    await provider(container);
  }

  return container;
};
