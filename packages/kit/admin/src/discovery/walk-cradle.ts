/**
 * Walk the Awilix DI cradle and return every entry that duck-types as an
 * `AdminDiscoverable` repository. The cradle is a Proxy that instantiates
 * dependencies on access, so resolving a key may throw (for example, a
 * repo that needs something the admin plugin does not have wired). Every
 * access is guarded: throwing entries and non-objects are silently skipped.
 */
import type { AdminDiscoverable, DiscoveredRepository } from '../types.js';

export interface WalkCradleOptions {
  readonly cradle: Record<string, unknown>;
  readonly includeTables?: readonly string[];
  readonly excludeTables?: readonly string[];
}

const REPO_KEY_RE = /Repository$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const quacksLikeRepository = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & AdminDiscoverable =>
  typeof value['table'] === 'string' &&
  typeof value['findPaginatedByPage'] === 'function' &&
  typeof value['findById'] === 'function' &&
  typeof value['create'] === 'function' &&
  typeof value['update'] === 'function' &&
  typeof value['deleteById'] === 'function';

const passesFilters = (
  table: string,
  include: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
): boolean => {
  if (include && include.length > 0 && !include.includes(table)) return false;
  if (exclude && exclude.includes(table)) return false;
  return true;
};

export const walkCradle = (
  opts: WalkCradleOptions,
): readonly DiscoveredRepository[] => {
  const { cradle, includeTables, excludeTables } = opts;
  const keys = Object.keys(cradle).filter((k) => REPO_KEY_RE.test(k));
  const found: DiscoveredRepository[] = [];

  for (const key of keys) {
    let resolved: unknown;
    try {
      resolved = cradle[key];
    } catch {
      continue;
    }

    if (!isRecord(resolved)) continue;
    if (!quacksLikeRepository(resolved)) continue;

    const repo = resolved as unknown as AdminDiscoverable;
    if (!passesFilters(repo.table, includeTables, excludeTables)) continue;

    found.push({ repositoryKey: key, repository: repo });
  }

  return [...found].toSorted((a, b) =>
    a.repositoryKey.localeCompare(b.repositoryKey),
  );
};
