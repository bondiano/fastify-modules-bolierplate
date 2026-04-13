/**
 * Raw `information_schema` + `pg_catalog` introspection. Returns a flat
 * list of column rows annotated with PK/FK/enum metadata. The registry
 * layer is responsible for folding these into `TableMeta`.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export interface QueryInformationSchemaOptions {
  readonly includeTables?: readonly string[];
  readonly excludeTables?: readonly string[];
}

/**
 * Shape of a single row returned by the introspection query.
 *
 * Keys are camelCase because the data source Kysely instance is always
 * wired with `CamelCasePlugin` -- raw `sql` result row keys get mapped
 * from snake_case to camelCase on the way back out.
 */
interface RawColumnRow {
  readonly tableName: string;
  readonly columnName: string;
  readonly dataType: string;
  readonly udtName: string;
  readonly isNullable: 'YES' | 'NO';
  readonly columnDefault: string | null;
  readonly isIdentity: 'YES' | 'NO';
  readonly isGenerated: 'ALWAYS' | 'NEVER';
  readonly characterMaximumLength: number | null;
  readonly isPrimaryKey: boolean;
  readonly fkTable: string | null;
  readonly fkColumn: string | null;
  readonly enumValues: readonly string[] | null;
  readonly ordinalPosition: number;
}

/**
 * Snapshot the `public` schema's columns. A single query builds a
 * self-contained view over `information_schema.columns` joined to PK/FK
 * constraint metadata and enum domains. One round-trip keeps boot fast.
 *
 * `pg_catalog` and `information_schema` tables are always filtered out
 * so that `excludeTables` only needs to deal with user-space names.
 */
export const queryInformationSchema = async (
  db: Kysely<unknown>,
  opts: QueryInformationSchemaOptions = {},
): Promise<readonly RawColumnRow[]> => {
  const include = opts.includeTables ?? [];
  const exclude = opts.excludeTables ?? [];

  // We build the filter lists as `text[]` parameters so the query plan
  // is stable regardless of how many tables the caller passes.
  const includeArray = sql<
    string[]
  >`${sql.val(include as readonly string[])}::text[]`;
  const excludeArray = sql<
    string[]
  >`${sql.val(exclude as readonly string[])}::text[]`;

  const query = sql<RawColumnRow>`
    with pk_cols as (
      select
        kcu.table_name,
        kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
       and tc.table_name = kcu.table_name
      where tc.constraint_type = 'PRIMARY KEY'
        and tc.table_schema = 'public'
    ),
    fk_cols as (
      select
        kcu.table_name,
        kcu.column_name,
        ccu.table_name  as fk_table,
        ccu.column_name as fk_column
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
       and tc.table_name = kcu.table_name
      join information_schema.constraint_column_usage ccu
        on tc.constraint_name = ccu.constraint_name
       and tc.table_schema = ccu.table_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
    ),
    enum_vals as (
      select
        t.typname as udt_name,
        array_agg(e.enumlabel order by e.enumsortorder) as enum_values
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      group by t.typname
    )
    select
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name,
      c.is_nullable,
      c.column_default,
      c.is_identity,
      c.is_generated,
      c.character_maximum_length,
      c.ordinal_position,
      (pk.column_name is not null) as is_primary_key,
      fk.fk_table,
      fk.fk_column,
      ev.enum_values
    from information_schema.columns c
    left join pk_cols pk
      on pk.table_name = c.table_name
     and pk.column_name = c.column_name
    left join fk_cols fk
      on fk.table_name = c.table_name
     and fk.column_name = c.column_name
    left join enum_vals ev
      on ev.udt_name = c.udt_name
    where c.table_schema = 'public'
      and (cardinality(${includeArray}) = 0 or c.table_name = any(${includeArray}))
      and (cardinality(${excludeArray}) = 0 or not (c.table_name = any(${excludeArray})))
    order by c.table_name, c.ordinal_position
  `;

  const result = await query.execute(db);
  return result.rows;
};
