import { describe, expect, it } from 'vitest';

import type { ColumnMeta, PgType } from '../types.js';

import { inferWidget } from './infer-widget.js';

const makeCol = (overrides: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name: 'col',
  rawName: 'col',
  type: 'text' as PgType,
  nullable: true,
  generated: false,
  defaultValue: null,
  enumValues: null,
  references: null,
  isPrimaryKey: false,
  maxLength: null,
  ...overrides,
});

describe('inferWidget', () => {
  it('returns readonly for a generated primary key', () => {
    expect(
      inferWidget(
        makeCol({ isPrimaryKey: true, generated: true, type: 'uuid' }),
      ),
    ).toBe('readonly');
  });

  it('returns autocomplete for any foreign key', () => {
    expect(
      inferWidget(
        makeCol({ type: 'uuid', references: { table: 'users', column: 'id' } }),
      ),
    ).toBe('autocomplete');
  });

  it('returns radio-group for small enums', () => {
    expect(
      inferWidget(
        makeCol({ type: 'enum', enumValues: ['draft', 'published'] }),
      ),
    ).toBe('radio-group');
  });

  it('returns select for large enums', () => {
    expect(
      inferWidget(
        makeCol({ type: 'enum', enumValues: ['a', 'b', 'c', 'd', 'e'] }),
      ),
    ).toBe('select');
  });

  it('returns checkbox for bool', () => {
    expect(inferWidget(makeCol({ type: 'bool' }))).toBe('checkbox');
  });

  it('returns number for every numeric type', () => {
    for (const t of [
      'int2',
      'int4',
      'int8',
      'numeric',
      'float4',
      'float8',
    ] as const) {
      expect(inferWidget(makeCol({ type: t }))).toBe('number');
    }
  });

  it('returns date for date', () => {
    expect(inferWidget(makeCol({ type: 'date' }))).toBe('date');
  });

  it('returns datetime for timestamp / timestamptz / time', () => {
    expect(inferWidget(makeCol({ type: 'timestamp' }))).toBe('datetime');
    expect(inferWidget(makeCol({ type: 'timestamptz' }))).toBe('datetime');
    expect(inferWidget(makeCol({ type: 'time' }))).toBe('datetime');
  });

  it('returns json for json / jsonb', () => {
    expect(inferWidget(makeCol({ type: 'json' }))).toBe('json');
    expect(inferWidget(makeCol({ type: 'jsonb' }))).toBe('json');
  });

  it('returns tags for text_array', () => {
    expect(inferWidget(makeCol({ type: 'text_array' }))).toBe('tags');
  });

  it('returns textarea for long / unbounded strings', () => {
    expect(inferWidget(makeCol({ type: 'text', maxLength: null }))).toBe(
      'textarea',
    );
    expect(inferWidget(makeCol({ type: 'varchar', maxLength: 500 }))).toBe(
      'textarea',
    );
  });

  it('returns text for short strings', () => {
    expect(inferWidget(makeCol({ type: 'varchar', maxLength: 100 }))).toBe(
      'text',
    );
    expect(inferWidget(makeCol({ type: 'char', maxLength: 20 }))).toBe('text');
  });

  it('returns text for uuid when not a FK', () => {
    expect(inferWidget(makeCol({ type: 'uuid' }))).toBe('text');
  });

  it('falls back to text for unknown types', () => {
    expect(inferWidget(makeCol({ type: 'unknown' }))).toBe('text');
  });
});
