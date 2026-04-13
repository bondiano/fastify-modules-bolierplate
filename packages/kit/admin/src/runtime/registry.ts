/**
 * In-process `AdminRegistry`. A thin Map facade over a list of resource
 * specs so route handlers can look up a spec by URL param without caring
 * where the specs came from (inference, overrides, etc.).
 */
import { NotFoundException } from '@kit/errors';

import type { AdminRegistry, AdminResourceSpec } from '../types.js';

export interface InternalAdminRegistry extends AdminRegistry {
  /** Strict lookup used by route handlers; throws `NotFoundException`. */
  getOrThrow(name: string): AdminResourceSpec;
}

export const createAdminRegistry = (
  specs: readonly AdminResourceSpec[],
): InternalAdminRegistry => {
  const byName = new Map<string, AdminResourceSpec>();
  for (const spec of specs) byName.set(spec.name, spec);

  const all = [...byName.values()];

  return {
    get: (name) => byName.get(name),
    all: () => all,
    getOrThrow: (name) => {
      const spec = byName.get(name);
      if (!spec)
        throw new NotFoundException(`Admin resource "${name}" not found`);
      return spec;
    },
  };
};
