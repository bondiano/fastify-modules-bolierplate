import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ColumnMeta, TableMeta } from '../types.js';

import { autogenValidators } from './autogen-validators.js';

beforeAll(() => {
  FormatRegistry.Set('uuid', (v) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  );
  FormatRegistry.Set('date-time', (v) => !Number.isNaN(Date.parse(v)));
  FormatRegistry.Set('date', (v) => /^\d{4}-\d{2}-\d{2}$/.test(v));
});

const uuid = '550e8400-e29b-41d4-a716-446655440000';

const makeCol = (overrides: Partial<ColumnMeta>): ColumnMeta => ({
  name: 'col',
  rawName: 'col',
  type: 'text',
  nullable: false,
  generated: false,
  defaultValue: null,
  enumValues: null,
  references: null,
  isPrimaryKey: false,
  maxLength: null,
  ...overrides,
});

const makeTable = (columns: readonly ColumnMeta[]): TableMeta => ({
  name: 'sample',
  columns,
  primaryKey: columns.filter((c) => c.isPrimaryKey).map((c) => c.rawName),
  hasSoftDelete: false,
  hasTenantColumn: false,
});

describe('autogenValidators - create schema', () => {
  it('requires non-nullable, default-less columns', () => {
    const table = makeTable([
      makeCol({
        name: 'id',
        rawName: 'id',
        type: 'uuid',
        isPrimaryKey: true,
        generated: true,
      }),
      makeCol({ name: 'title', rawName: 'title', type: 'text' }),
      makeCol({
        name: 'status',
        rawName: 'status',
        type: 'text',
        defaultValue: "'draft'",
      }),
    ]);
    const { create } = autogenValidators(table);

    expect(Value.Check(create, { title: 'hello' })).toBe(true);
    expect(Value.Check(create, { title: 'hello', status: 'published' })).toBe(
      true,
    );
    expect(Value.Check(create, {})).toBe(false);
    expect(Value.Check(create, { title: 123 })).toBe(false);
  });

  it('skips generated columns entirely', () => {
    const table = makeTable([
      makeCol({
        name: 'id',
        rawName: 'id',
        type: 'uuid',
        isPrimaryKey: true,
        generated: true,
      }),
      makeCol({ name: 'name', rawName: 'name', type: 'text' }),
    ]);
    const { create } = autogenValidators(table);

    expect(Value.Check(create, { name: 'x' })).toBe(true);
    // Providing a generated column is rejected because additionalProperties: false.
    expect(Value.Check(create, { id: uuid, name: 'x' })).toBe(false);
  });

  it('enforces varchar maxLength', () => {
    const table = makeTable([
      makeCol({ name: 'code', rawName: 'code', type: 'varchar', maxLength: 4 }),
    ]);
    const { create } = autogenValidators(table);

    expect(Value.Check(create, { code: 'ABC' })).toBe(true);
    expect(Value.Check(create, { code: 'ABCDE' })).toBe(false);
  });

  it('validates uuid format on uuid columns', () => {
    const table = makeTable([
      makeCol({ name: 'authorId', rawName: 'author_id', type: 'uuid' }),
    ]);
    const { create } = autogenValidators(table);

    expect(Value.Check(create, { authorId: uuid })).toBe(true);
    expect(Value.Check(create, { authorId: 'nope' })).toBe(false);
  });

  it('accepts null for nullable columns', () => {
    const table = makeTable([
      makeCol({ name: 'bio', rawName: 'bio', type: 'text', nullable: true }),
    ]);
    const { create } = autogenValidators(table);

    expect(Value.Check(create, { bio: null })).toBe(true);
    expect(Value.Check(create, { bio: 'hi' })).toBe(true);
    expect(Value.Check(create, {})).toBe(true);
  });

  it('validates enum columns', () => {
    const table = makeTable([
      makeCol({
        name: 'status',
        rawName: 'status',
        type: 'enum',
        enumValues: ['draft', 'published'],
      }),
    ]);
    const { create } = autogenValidators(table);

    expect(Value.Check(create, { status: 'draft' })).toBe(true);
    expect(Value.Check(create, { status: 'archived' })).toBe(false);
  });

  it('validates integer, number, boolean, jsonb, and text_array types', () => {
    const table = makeTable([
      makeCol({ name: 'count', rawName: 'count', type: 'int4' }),
      makeCol({ name: 'ratio', rawName: 'ratio', type: 'numeric' }),
      makeCol({ name: 'active', rawName: 'active', type: 'bool' }),
      makeCol({ name: 'tags', rawName: 'tags', type: 'text_array' }),
      makeCol({ name: 'meta', rawName: 'meta', type: 'jsonb' }),
    ]);
    const { create } = autogenValidators(table);

    expect(
      Value.Check(create, {
        count: 5,
        ratio: 1.5,
        active: true,
        tags: ['a', 'b'],
        meta: { anything: 1 },
      }),
    ).toBe(true);
    expect(
      Value.Check(create, {
        count: 'five',
        ratio: 1.5,
        active: true,
        tags: [],
        meta: {},
      }),
    ).toBe(false);
    expect(
      Value.Check(create, {
        count: 5,
        ratio: 1.5,
        active: 1,
        tags: [],
        meta: {},
      }),
    ).toBe(false);
    expect(
      Value.Check(create, {
        count: 5,
        ratio: 1.5,
        active: true,
        tags: [1],
        meta: {},
      }),
    ).toBe(false);
  });

  it('validates timestamp columns as ISO date-time strings', () => {
    const table = makeTable([
      makeCol({
        name: 'happenedAt',
        rawName: 'happened_at',
        type: 'timestamptz',
      }),
    ]);
    const { create } = autogenValidators(table);

    expect(
      Value.Check(create, { happenedAt: '2025-01-01T00:00:00.000Z' }),
    ).toBe(true);
    expect(Value.Check(create, { happenedAt: 'not a date' })).toBe(false);
  });
});

describe('autogenValidators - update schema', () => {
  it('drops primary-key columns and makes every field optional', () => {
    const table = makeTable([
      makeCol({
        name: 'id',
        rawName: 'id',
        type: 'uuid',
        isPrimaryKey: true,
        generated: true,
      }),
      makeCol({ name: 'title', rawName: 'title', type: 'text' }),
      makeCol({ name: 'status', rawName: 'status', type: 'text' }),
    ]);
    const { update } = autogenValidators(table);

    expect(Value.Check(update, {})).toBe(true);
    expect(Value.Check(update, { title: 'changed' })).toBe(true);
    expect(Value.Check(update, { status: 'published' })).toBe(true);
    // Primary key is not on the update schema.
    expect(Value.Check(update, { id: uuid })).toBe(false);
  });

  it('still validates field types when supplied', () => {
    const table = makeTable([
      makeCol({
        name: 'id',
        rawName: 'id',
        type: 'uuid',
        isPrimaryKey: true,
        generated: true,
      }),
      makeCol({ name: 'count', rawName: 'count', type: 'int4' }),
    ]);
    const { update } = autogenValidators(table);

    expect(Value.Check(update, { count: 10 })).toBe(true);
    expect(Value.Check(update, { count: 'ten' })).toBe(false);
  });
});
