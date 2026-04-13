/**
 * Auto-loader for `*.admin.ts` override modules. Uses Node's built-in
 * `fs/promises.glob` (Node 22+) to find files, dynamic-imports each
 * match, validates that the default export quacks like an
 * `AdminResourceDefinition`, and returns the collected list.
 *
 * Never throws: bad files log a warning and get skipped so one broken
 * override cannot crash admin boot.
 */
import { glob } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import type { AdminResourceDefinition } from '../types.js';

export interface LoadOverridesLogger {
  warn: (object: unknown, message: string) => void;
}

export interface LoadOverridesOptions {
  readonly modulesGlob: string | undefined;
  readonly logger?: LoadOverridesLogger;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const looksLikeDefinition = (
  value: unknown,
): value is AdminResourceDefinition => {
  if (!isRecord(value)) return false;
  return (
    typeof value['table'] === 'string' && typeof value['factory'] === 'function'
  );
};

const warn = (
  logger: LoadOverridesLogger | undefined,
  object: unknown,
  message: string,
): void => {
  if (logger) logger.warn(object, message);
};

export const loadOverrides = async (
  opts: LoadOverridesOptions,
): Promise<readonly AdminResourceDefinition[]> => {
  const { modulesGlob, logger } = opts;
  if (modulesGlob === undefined || modulesGlob.length === 0) return [];

  const found: AdminResourceDefinition[] = [];

  try {
    for await (const match of glob(modulesGlob)) {
      const path = typeof match === 'string' ? match : String(match);
      try {
        const module_: unknown = await import(pathToFileURL(path).href);
        const definition = isRecord(module_) ? module_['default'] : undefined;
        if (!looksLikeDefinition(definition)) {
          warn(
            logger,
            { path },
            '@kit/admin: ignoring override file -- default export is not an AdminResourceDefinition',
          );
          continue;
        }
        found.push(definition);
      } catch (error) {
        warn(
          logger,
          { err: error, path },
          '@kit/admin: failed to import override module',
        );
      }
    }
  } catch (error) {
    warn(
      logger,
      { err: error, modulesGlob },
      '@kit/admin: override glob failed',
    );
    return [];
  }

  return found;
};
