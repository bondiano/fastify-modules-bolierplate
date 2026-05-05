/**
 * Pure boot helper: merges discovered repositories with schema metadata
 * and optional overrides into the final list of `AdminResourceSpec`
 * plus a parallel `AdminDiscoverable` repository map. Pulled out of the
 * plugin so it can be unit-tested without a Fastify instance.
 */
import {
  inferSpec,
  mergeOverrides,
  walkCradle,
  type WalkCradleOptions,
} from '../discovery/index.js';
import { autogenValidators } from '../schema/autogen-validators.js';
import type {
  AdminDiscoverable,
  AdminResourceDefinition,
  AdminResourceOverride,
  AdminResourceSpec,
  FilterSpec,
  ListViewSpec,
  RelationDescriptor,
  SchemaRegistry,
} from '../types.js';

export interface BuildAdminSpecsLogger {
  warn(object: unknown, message: string): void;
}

export interface BuildAdminSpecsOptions {
  readonly cradle: Record<string, unknown>;
  readonly schemaRegistry: SchemaRegistry;
  readonly overrides: readonly AdminResourceDefinition[];
  readonly logger?: BuildAdminSpecsLogger;
  readonly includeTables?: readonly string[];
  readonly excludeTables?: readonly string[];
}

export interface BuildAdminSpecsResult {
  readonly specs: readonly AdminResourceSpec[];
  readonly repos: ReadonlyMap<string, AdminDiscoverable>;
}

const resolveRelations = async (
  relations: NonNullable<AdminResourceOverride['relations']>,
  cradle: Record<string, unknown>,
): Promise<Record<string, RelationDescriptor>> => {
  const resolved: Record<string, RelationDescriptor> = {};
  for (const [key, value] of Object.entries(relations)) {
    resolved[key] =
      typeof value === 'function' ? await value({ cradle }) : value;
  }
  return resolved;
};

/**
 * Materialise `FilterSpec` entries with `options: 'distinct'` by querying
 * the backing repository's `distinctValues(column)` helper at boot. Falls
 * back to a single empty option when the repo doesn't expose the helper
 * -- the filter still renders, just with no preset values.
 */
const resolveListFilters = async (
  list: ListViewSpec,
  repo: AdminDiscoverable,
  logger?: BuildAdminSpecsLogger,
): Promise<ListViewSpec> => {
  const distinctsNeeded = list.filters.some(
    (f) => f.kind === 'select' && f.options === 'distinct',
  );
  if (!distinctsNeeded) return list;

  const resolved: FilterSpec[] = [];
  for (const filter of list.filters) {
    if (filter.kind !== 'select' || filter.options !== 'distinct') {
      resolved.push(filter);
      continue;
    }
    if (typeof repo.distinctValues !== 'function') {
      logger?.warn(
        { table: repo.table, column: filter.name },
        '@kit/admin: filter declared options:"distinct" but repository has no distinctValues(); rendering empty',
      );
      resolved.push({ ...filter, options: [] });
      continue;
    }
    try {
      const values = await repo.distinctValues(filter.name);
      resolved.push({
        ...filter,
        options: values.map((v) => ({ value: v, label: v })),
      });
    } catch (error) {
      logger?.warn(
        { table: repo.table, column: filter.name, err: error },
        '@kit/admin: distinctValues() threw; rendering empty filter',
      );
      resolved.push({ ...filter, options: [] });
    }
  }
  return { ...list, filters: resolved };
};

export const buildAdminSpecs = async (
  opts: BuildAdminSpecsOptions,
): Promise<BuildAdminSpecsResult> => {
  const { cradle, schemaRegistry, overrides, logger } = opts;

  const walkOpts: WalkCradleOptions = {
    cradle,
    ...(opts.includeTables ? { includeTables: opts.includeTables } : {}),
    ...(opts.excludeTables ? { excludeTables: opts.excludeTables } : {}),
  };
  const discovered = walkCradle(walkOpts);
  const overridesByTable = new Map(overrides.map((d) => [d.table, d] as const));

  const specs: AdminResourceSpec[] = [];
  const repos = new Map<string, AdminDiscoverable>();

  for (const disc of discovered) {
    const tableMeta = schemaRegistry.get(disc.repository.table);
    if (!tableMeta) {
      logger?.warn(
        { table: disc.repository.table, repositoryKey: disc.repositoryKey },
        '@kit/admin: no schema meta for discovered repository; skipping',
      );
      continue;
    }

    const validators = autogenValidators(tableMeta);
    const inferred = inferSpec({ discovered: disc, tableMeta, validators });

    const definition = overridesByTable.get(disc.repository.table);
    let finalSpec: AdminResourceSpec;
    if (definition) {
      const override = await definition.factory({
        cradle,
        registry: schemaRegistry,
      });
      const resolvedRelations = override.relations
        ? await resolveRelations(override.relations, cradle)
        : {};
      finalSpec = mergeOverrides(inferred, override, resolvedRelations);
    } else {
      finalSpec = mergeOverrides(inferred, undefined, {});
    }

    const resolvedList = await resolveListFilters(
      finalSpec.list,
      disc.repository,
      logger,
    );
    if (resolvedList !== finalSpec.list) {
      finalSpec = { ...finalSpec, list: resolvedList };
    }

    specs.push(finalSpec);
    repos.set(finalSpec.name, disc.repository);
  }

  return { specs, repos };
};
