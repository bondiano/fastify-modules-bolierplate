/**
 * Boot-time schema registry. Calls `queryInformationSchema`, normalises
 * raw Postgres metadata into `TableMeta`, and exposes a simple Map-backed
 * lookup keyed by raw (snake_case) table name -- that is the shape
 * repositories advertise via `BaseRepository.table`.
 */
import type { Kysely } from 'kysely';

import type {
  ColumnMeta,
  PgType,
  SchemaRegistry,
  TableMeta,
} from '../types.js';

import { queryInformationSchema } from './queries.js';

export interface CreateSchemaRegistryOptions {
  readonly dataSource: Kysely<unknown>;
  readonly includeTables?: readonly string[];
  readonly excludeTables?: readonly string[];
}

/**
 * Subset of `RawColumnRow` the registry cares about. Kept local so
 * `queries.ts` can keep its row type private -- registry tests stub
 * this shape directly to avoid a database dependency.
 */
export interface RawColumnRowLike {
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
}

/**
 * Turn a snake_case identifier into camelCase. Matches the rules used by
 * Kysely's `CamelCasePlugin` closely enough for our purposes: consecutive
 * underscores collapse, a trailing underscore is dropped, and a leading
 * underscore is preserved.
 */
export const snakeToCamel = (input: string): string => {
  if (input.length === 0) return input;
  const [head, ...rest] = input.split('_');
  const parts = rest
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return (head ?? '') + parts.join('');
};

/**
 * Map a Postgres `data_type` / `udt_name` / enum-values triple to one of
 * our normalised tags. Anything unrecognised becomes `'unknown'` so the
 * admin renders a JSON textarea instead of crashing.
 */
export const mapPgType = (
  dataType: string,
  udtName: string,
  enumValues: readonly string[] | null,
): PgType => {
  switch (dataType) {
    case 'uuid': {
      return 'uuid';
    }
    case 'text': {
      return 'text';
    }
    case 'character varying': {
      return 'varchar';
    }
    case 'character': {
      return 'char';
    }
    case 'smallint': {
      return 'int2';
    }
    case 'integer': {
      return 'int4';
    }
    case 'bigint': {
      return 'int8';
    }
    case 'numeric':
    case 'decimal': {
      return 'numeric';
    }
    case 'real': {
      return 'float4';
    }
    case 'double precision': {
      return 'float8';
    }
    case 'boolean': {
      return 'bool';
    }
    case 'date': {
      return 'date';
    }
    case 'time without time zone':
    case 'time with time zone': {
      return 'time';
    }
    case 'timestamp without time zone': {
      return 'timestamp';
    }
    case 'timestamp with time zone': {
      return 'timestamptz';
    }
    case 'json': {
      return 'json';
    }
    case 'jsonb': {
      return 'jsonb';
    }
    case 'ARRAY': {
      return udtName === '_text' || udtName === '_varchar'
        ? 'text_array'
        : 'unknown';
    }
    case 'USER-DEFINED': {
      return enumValues !== null && enumValues.length > 0 ? 'enum' : 'unknown';
    }
    default: {
      return 'unknown';
    }
  }
};

/**
 * A column is considered "generated" (hidden from create forms, read-only
 * on update) if Postgres fills it in automatically. Identity and
 * `GENERATED ALWAYS` are the obvious cases; we also flag sequence-backed
 * defaults (`nextval(...)`) and UUID PK defaults. We treat
 * `gen_random_uuid()` / `uuid_generate_v4()` on a PK column as generated
 * because otherwise the admin form would demand a client-supplied id and
 * the create action would always fail validation.
 */
const isGeneratedColumn = (row: RawColumnRowLike): boolean => {
  if (row.isIdentity === 'YES') return true;
  if (row.isGenerated === 'ALWAYS') return true;

  const definition = row.columnDefault;
  if (definition === null) return false;
  if (definition.startsWith('nextval(')) return true;

  if (row.isPrimaryKey) {
    const normalised = definition.toLowerCase().replaceAll(/\s+/g, '');
    if (normalised.startsWith('gen_random_uuid(')) return true;
    if (normalised.startsWith('uuid_generate_v4(')) return true;
  }

  return false;
};

const toColumnMeta = (row: RawColumnRowLike): ColumnMeta => {
  const type = mapPgType(row.dataType, row.udtName, row.enumValues);

  return {
    name: snakeToCamel(row.columnName),
    rawName: row.columnName,
    type,
    nullable: row.isNullable === 'YES',
    generated: isGeneratedColumn(row),
    defaultValue: row.columnDefault,
    enumValues: row.enumValues,
    references:
      row.fkTable !== null && row.fkColumn !== null
        ? { table: row.fkTable, column: row.fkColumn }
        : null,
    isPrimaryKey: row.isPrimaryKey,
    maxLength:
      type === 'varchar' || type === 'char' ? row.characterMaximumLength : null,
  };
};

/**
 * Fold raw rows into a list of `TableMeta`. Exposed separately from
 * `createSchemaRegistry` so unit tests can exercise the pure mapping
 * logic without a database round-trip.
 */
export const buildTableMetas = (
  rows: readonly RawColumnRowLike[],
): readonly TableMeta[] => {
  const byTable = new Map<string, RawColumnRowLike[]>();
  for (const row of rows) {
    const bucket = byTable.get(row.tableName);
    if (bucket) {
      bucket.push(row);
    } else {
      byTable.set(row.tableName, [row]);
    }
  }

  const tables: TableMeta[] = [];
  for (const [tableName, tableRows] of byTable) {
    const columns = tableRows.map((r) => toColumnMeta(r));
    const primaryKey = columns
      .filter((c) => c.isPrimaryKey)
      .map((c) => c.rawName);
    const hasSoftDelete = columns.some(
      (c) => c.rawName === 'deleted_at' && c.nullable,
    );
    tables.push({ name: tableName, columns, primaryKey, hasSoftDelete });
  }
  return tables;
};

export const createSchemaRegistry = async (
  opts: CreateSchemaRegistryOptions,
): Promise<SchemaRegistry> => {
  const rows = await queryInformationSchema(opts.dataSource, {
    ...(opts.includeTables === undefined
      ? {}
      : { includeTables: opts.includeTables }),
    ...(opts.excludeTables === undefined
      ? {}
      : { excludeTables: opts.excludeTables }),
  });
  const tables = buildTableMetas(rows as readonly RawColumnRowLike[]);

  const byName = new Map<string, TableMeta>();
  for (const table of tables) {
    byName.set(table.name, table);
  }

  return {
    get: (table) => byName.get(table),
    all: () => [...byName.values()],
  };
};
