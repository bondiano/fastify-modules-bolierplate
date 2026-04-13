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

    specs.push(finalSpec);
    repos.set(finalSpec.name, disc.repository);
  }

  return { specs, repos };
};
