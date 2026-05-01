/**
 * Generate TypeBox `create` / `update` validators for a table from its
 * introspected column metadata. The admin panel's create/update routes
 * plug the result straight into Fastify's schema validation.
 *
 * Rules:
 * - Generated columns (identity, `gen_random_uuid()`, defaults) are
 *   excluded from both schemas so callers don't have to provide values
 *   Postgres will fill in.
 * - Nullable columns are wrapped in `Type.Union([schema, Type.Null()])`.
 * - The `create` schema requires any non-nullable column that has no
 *   default value; everything else is optional.
 * - The `update` schema drops primary-key columns entirely and marks
 *   every remaining field as optional so partial updates work.
 * - Tenant-scoped tables exclude `tenant_id` (camelCased `tenantId`)
 *   from both schemas since the tenant-scoped repository auto-stamps it
 *   from the active frame -- the admin form must not require the user
 *   to supply it.
 */
import { Type } from '@sinclair/typebox';
import type { TObject, TSchema } from '@sinclair/typebox';
import { match } from 'ts-pattern';

import type { ColumnMeta, TableMeta } from '../types.js';

export interface AutogenValidators {
  readonly create: TObject;
  readonly update: TObject;
}

const enumToSchema = (values: readonly string[]): TSchema => {
  if (values.length === 0) return Type.Never();
  if (values.length === 1) return Type.Literal(values[0] ?? '');
  return Type.Union(values.map((v) => Type.Literal(v)));
};

const columnToTypeBox = (col: ColumnMeta): TSchema => {
  const base = match(col.type)
    .with('uuid', () => Type.String({ format: 'uuid' }))
    .with('text', () => Type.String())
    .with('varchar', 'char', () =>
      col.maxLength === null
        ? Type.String()
        : Type.String({ maxLength: col.maxLength }),
    )
    .with('int2', 'int4', 'int8', () => Type.Integer())
    .with('numeric', 'float4', 'float8', () => Type.Number())
    .with('bool', () => Type.Boolean())
    .with('date', () => Type.String({ format: 'date' }))
    .with('timestamp', 'timestamptz', 'time', () =>
      Type.String({ format: 'date-time' }),
    )
    .with('json', 'jsonb', () => Type.Unknown())
    .with('text_array', () => Type.Array(Type.String()))
    .with('enum', () => enumToSchema(col.enumValues ?? []))
    .otherwise(() => Type.Unknown());

  return col.nullable ? Type.Union([base, Type.Null()]) : base;
};

const isRequiredForCreate = (col: ColumnMeta): boolean =>
  !col.nullable && col.defaultValue === null;

// TypeBox's `Type.Object` expects a concrete properties object; building
// one up from a `Record<string, TSchema>` fights the generic inference.
// We collect plain objects and rely on `Type.Object` to re-derive a
// `TObject` at the function boundary.
const buildObject = (fields: Record<string, TSchema>): TObject =>
  Type.Object(fields, { additionalProperties: false });

const isTenantColumn = (col: ColumnMeta, tenantScoped: boolean): boolean => {
  if (!tenantScoped) return false;
  return col.name === 'tenantId' || col.rawName === 'tenant_id';
};

export const autogenValidators = (table: TableMeta): AutogenValidators => {
  const createFields: Record<string, TSchema> = {};
  const updateFields: Record<string, TSchema> = {};

  for (const col of table.columns) {
    if (col.generated) continue;
    if (isTenantColumn(col, table.hasTenantColumn)) continue;

    const schema = columnToTypeBox(col);
    const key = col.name;

    createFields[key] = isRequiredForCreate(col)
      ? schema
      : Type.Optional(schema);

    if (!col.isPrimaryKey) {
      updateFields[key] = Type.Optional(schema);
    }
  }

  return {
    create: buildObject(createFields),
    update: buildObject(updateFields),
  };
};
