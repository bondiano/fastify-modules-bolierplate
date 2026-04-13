import { describe, expect, it } from 'vitest';

import {
  buildTableMetas,
  mapPgType,
  snakeToCamel,
  type RawColumnRowLike,
} from './registry.js';

const makeRow = (
  overrides: Partial<RawColumnRowLike> = {},
): RawColumnRowLike => ({
  tableName: 'users',
  columnName: 'id',
  dataType: 'uuid',
  udtName: 'uuid',
  isNullable: 'NO',
  columnDefault: null,
  isIdentity: 'NO',
  isGenerated: 'NEVER',
  characterMaximumLength: null,
  isPrimaryKey: false,
  fkTable: null,
  fkColumn: null,
  enumValues: null,
  ...overrides,
});

describe('snakeToCamel', () => {
  it('leaves single tokens alone', () => {
    expect(snakeToCamel('id')).toBe('id');
  });

  it('camelCases snake_case identifiers', () => {
    expect(snakeToCamel('created_at')).toBe('createdAt');
    expect(snakeToCamel('password_hash')).toBe('passwordHash');
  });

  it('handles multi-segment names', () => {
    expect(snakeToCamel('first_name_last')).toBe('firstNameLast');
  });

  it('tolerates an empty input', () => {
    expect(snakeToCamel('')).toBe('');
  });
});

describe('mapPgType', () => {
  it('maps scalar Postgres types', () => {
    expect(mapPgType('uuid', 'uuid', null)).toBe('uuid');
    expect(mapPgType('text', 'text', null)).toBe('text');
    expect(mapPgType('character varying', 'varchar', null)).toBe('varchar');
    expect(mapPgType('integer', 'int4', null)).toBe('int4');
    expect(mapPgType('bigint', 'int8', null)).toBe('int8');
    expect(mapPgType('boolean', 'bool', null)).toBe('bool');
    expect(mapPgType('numeric', 'numeric', null)).toBe('numeric');
    expect(mapPgType('double precision', 'float8', null)).toBe('float8');
    expect(mapPgType('jsonb', 'jsonb', null)).toBe('jsonb');
    expect(mapPgType('timestamp with time zone', 'timestamptz', null)).toBe(
      'timestamptz',
    );
    expect(mapPgType('timestamp without time zone', 'timestamp', null)).toBe(
      'timestamp',
    );
    expect(mapPgType('date', 'date', null)).toBe('date');
    expect(mapPgType('time without time zone', 'time', null)).toBe('time');
  });

  it('detects text arrays', () => {
    expect(mapPgType('ARRAY', '_text', null)).toBe('text_array');
    expect(mapPgType('ARRAY', '_varchar', null)).toBe('text_array');
    expect(mapPgType('ARRAY', '_int4', null)).toBe('unknown');
  });

  it('detects enum domains only when values are present', () => {
    expect(
      mapPgType('USER-DEFINED', 'post_status', ['draft', 'published']),
    ).toBe('enum');
    expect(mapPgType('USER-DEFINED', 'mystery_domain', null)).toBe('unknown');
  });

  it('falls back to unknown for anything unrecognised', () => {
    expect(mapPgType('point', 'point', null)).toBe('unknown');
  });
});

describe('buildTableMetas', () => {
  it('groups rows by table and sets primary keys', () => {
    const tables = buildTableMetas([
      makeRow({
        tableName: 'users',
        columnName: 'id',
        isPrimaryKey: true,
        columnDefault: 'gen_random_uuid()',
      }),
      makeRow({
        tableName: 'users',
        columnName: 'email',
        dataType: 'character varying',
        udtName: 'varchar',
        characterMaximumLength: 255,
      }),
      makeRow({
        tableName: 'posts',
        columnName: 'id',
        isPrimaryKey: true,
        columnDefault: 'gen_random_uuid()',
      }),
    ]);

    expect(tables).toHaveLength(2);

    const users = tables.find((t) => t.name === 'users');
    expect(users).toBeDefined();
    expect(users?.primaryKey).toEqual(['id']);
    expect(users?.columns.map((c) => c.name)).toEqual(['id', 'email']);

    const emailCol = users?.columns.find((c) => c.rawName === 'email');
    expect(emailCol?.type).toBe('varchar');
    expect(emailCol?.maxLength).toBe(255);
  });

  it('normalises column names from snake_case to camelCase', () => {
    const [table] = buildTableMetas([
      makeRow({
        tableName: 'posts',
        columnName: 'created_at',
        dataType: 'timestamp with time zone',
      }),
    ]);
    expect(table?.columns[0]?.name).toBe('createdAt');
    expect(table?.columns[0]?.rawName).toBe('created_at');
    expect(table?.columns[0]?.type).toBe('timestamptz');
  });

  it('marks UUID PK defaults as generated', () => {
    const [table] = buildTableMetas([
      makeRow({
        tableName: 'users',
        columnName: 'id',
        isPrimaryKey: true,
        columnDefault: 'gen_random_uuid()',
      }),
    ]);
    const idCol = table?.columns[0];
    expect(idCol?.generated).toBe(true);
  });

  it('marks nextval defaults as generated', () => {
    const [table] = buildTableMetas([
      makeRow({
        tableName: 'seqtable',
        columnName: 'id',
        dataType: 'integer',
        udtName: 'int4',
        isPrimaryKey: true,
        columnDefault: "nextval('seqtable_id_seq'::regclass)",
      }),
    ]);
    expect(table?.columns[0]?.generated).toBe(true);
  });

  it('marks identity columns as generated', () => {
    const [table] = buildTableMetas([
      makeRow({
        tableName: 't',
        columnName: 'id',
        dataType: 'integer',
        udtName: 'int4',
        isIdentity: 'YES',
        isPrimaryKey: true,
      }),
    ]);
    expect(table?.columns[0]?.generated).toBe(true);
  });

  it('does NOT mark plain non-PK UUID columns with a uuid default as generated', () => {
    // Only PK UUIDs get the free-pass treatment; a nullable UUID with a
    // default is still treated as user-supplied.
    const [table] = buildTableMetas([
      makeRow({
        tableName: 't',
        columnName: 'token',
        isPrimaryKey: false,
        columnDefault: 'gen_random_uuid()',
      }),
    ]);
    expect(table?.columns[0]?.generated).toBe(false);
  });

  it('detects soft delete via nullable deleted_at', () => {
    const [table] = buildTableMetas([
      makeRow({ tableName: 'posts', columnName: 'id', isPrimaryKey: true }),
      makeRow({
        tableName: 'posts',
        columnName: 'deleted_at',
        dataType: 'timestamp with time zone',
        isNullable: 'YES',
      }),
    ]);
    expect(table?.hasSoftDelete).toBe(true);
  });

  it('does not flag soft delete when deleted_at is NOT NULL', () => {
    const [table] = buildTableMetas([
      makeRow({ tableName: 'posts', columnName: 'id', isPrimaryKey: true }),
      makeRow({
        tableName: 'posts',
        columnName: 'deleted_at',
        dataType: 'timestamp with time zone',
        isNullable: 'NO',
      }),
    ]);
    expect(table?.hasSoftDelete).toBe(false);
  });

  it('does not flag soft delete on tables without deleted_at', () => {
    const [table] = buildTableMetas([
      makeRow({ tableName: 'users', columnName: 'id', isPrimaryKey: true }),
      makeRow({ tableName: 'users', columnName: 'email', dataType: 'text' }),
    ]);
    expect(table?.hasSoftDelete).toBe(false);
  });

  it('records foreign-key references', () => {
    const [table] = buildTableMetas([
      makeRow({
        tableName: 'posts',
        columnName: 'author_id',
        fkTable: 'users',
        fkColumn: 'id',
      }),
    ]);
    expect(table?.columns[0]?.references).toEqual({
      table: 'users',
      column: 'id',
    });
  });
});
