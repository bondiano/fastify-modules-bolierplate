import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

import type {
  AdminDiscoverable,
  ColumnMeta,
  DiscoveredRepository,
  PgType,
  TableMeta,
} from '../types.js';

import { inferSpec } from './infer-spec.js';
import type { AutogenValidators } from './infer-spec.js';

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

const makeRepo = (table: string): AdminDiscoverable => ({
  table,
  findPaginatedByPage: async () => ({ items: [], total: 0 }),
  findById: async () => {},
  create: async (data) => data,
  update: async (_id, data) => data,
  deleteById: async () => {},
});

const makeDiscovered = (table: string, key: string): DiscoveredRepository => ({
  repositoryKey: key,
  repository: makeRepo(table),
});

const makeValidators = (): AutogenValidators => ({
  create: Type.Object({}),
  update: Type.Object({}),
});

const makeTable = (overrides: Partial<TableMeta> = {}): TableMeta => ({
  name: 'posts',
  columns: [
    makeCol({
      name: 'id',
      rawName: 'id',
      type: 'uuid',
      nullable: false,
      generated: true,
      isPrimaryKey: true,
    }),
    makeCol({
      name: 'title',
      rawName: 'title',
      type: 'varchar',
      nullable: false,
      maxLength: 200,
    }),
  ],
  primaryKey: ['id'],
  hasSoftDelete: false,
  hasTenantColumn: false,
  ...overrides,
});

describe('inferSpec', () => {
  it('produces a spec with expected top-level shape', () => {
    const spec = inferSpec({
      discovered: makeDiscovered('posts', 'postsRepository'),
      tableMeta: makeTable(),
      validators: makeValidators(),
    });

    expect(spec.name).toBe('posts');
    expect(spec.table).toBe('posts');
    expect(spec.repositoryKey).toBe('postsRepository');
    expect(spec.label).toBe('Posts');
    expect(spec.icon).toBeNull();
    expect(spec.fields).toHaveLength(2);
    expect(spec.hasSoftDelete).toBe(false);
    expect(spec.permissions.subject).toBe('Post');
    expect(spec.form.fieldsets).toBeNull();
    expect(spec.rowActions).toEqual([]);
  });

  it('humanises multi-word snake_case tables and singularises for subject', () => {
    const spec = inferSpec({
      discovered: makeDiscovered('order_items', 'orderItemsRepository'),
      tableMeta: makeTable({ name: 'order_items' }),
      validators: makeValidators(),
    });
    expect(spec.label).toBe('Order Items');
    expect(spec.permissions.subject).toBe('OrderItem');
  });

  it('marks generated PK read-only and non-generated non-null as required', () => {
    const spec = inferSpec({
      discovered: makeDiscovered('posts', 'postsRepository'),
      tableMeta: makeTable(),
      validators: makeValidators(),
    });
    const id = spec.fields.find((f) => f.name === 'id')!;
    const title = spec.fields.find((f) => f.name === 'title')!;
    expect(id.readOnly).toBe(true);
    expect(id.widget).toBe('readonly');
    expect(title.required).toBe(true);
    expect(title.readOnly).toBe(false);
  });

  it('builds list.columns with PK first then non-generated columns, capped at 6', () => {
    const many: ColumnMeta[] = [
      makeCol({
        name: 'id',
        isPrimaryKey: true,
        generated: true,
        type: 'uuid',
        nullable: false,
      }),
      makeCol({ name: 'a', type: 'text' }),
      makeCol({ name: 'b', type: 'text' }),
      makeCol({ name: 'c', type: 'text' }),
      makeCol({ name: 'd', type: 'text' }),
      makeCol({ name: 'e', type: 'text' }),
      makeCol({ name: 'f', type: 'text' }),
      makeCol({ name: 'g', type: 'text' }),
      makeCol({
        name: 'createdAt',
        type: 'timestamptz',
        generated: true,
        nullable: false,
      }),
      makeCol({
        name: 'deletedAt',
        type: 'timestamptz',
        nullable: true,
      }),
    ];
    const spec = inferSpec({
      discovered: makeDiscovered('things', 'thingsRepository'),
      tableMeta: makeTable({
        name: 'things',
        columns: many,
        primaryKey: ['id'],
        hasSoftDelete: true,
      }),
      validators: makeValidators(),
    });
    expect(spec.list.columns).toEqual(['id', 'a', 'b', 'c', 'd', 'e']);
    expect(spec.list.columns).toHaveLength(6);
    expect(spec.list.columns).not.toContain('deletedAt');
    expect(spec.list.columns).not.toContain('createdAt');
    expect(spec.hasSoftDelete).toBe(true);
  });

  it('defaults sort to createdAt desc when present, else first PK', () => {
    const withCreated = inferSpec({
      discovered: makeDiscovered('posts', 'postsRepository'),
      tableMeta: makeTable({
        columns: [
          makeCol({ name: 'id', isPrimaryKey: true, generated: true }),
          makeCol({ name: 'createdAt', type: 'timestamptz' }),
        ],
      }),
      validators: makeValidators(),
    });
    expect(withCreated.list.defaultSort).toEqual({
      field: 'createdAt',
      order: 'desc',
    });

    const noCreated = inferSpec({
      discovered: makeDiscovered('posts', 'postsRepository'),
      tableMeta: makeTable({
        columns: [makeCol({ name: 'id', isPrimaryKey: true, generated: true })],
      }),
      validators: makeValidators(),
    });
    expect(noCreated.list.defaultSort).toEqual({ field: 'id', order: 'desc' });
  });

  it('emits relations for FK columns using the referenced table', () => {
    const spec = inferSpec({
      discovered: makeDiscovered('posts', 'postsRepository'),
      tableMeta: makeTable({
        columns: [
          makeCol({
            name: 'id',
            type: 'uuid',
            isPrimaryKey: true,
            generated: true,
          }),
          makeCol({
            name: 'authorId',
            type: 'uuid',
            references: { table: 'users', column: 'id' },
          }),
        ],
      }),
      validators: makeValidators(),
    });
    expect(spec.relations['authorId']).toEqual({
      resource: 'users',
      display: 'id',
    });
  });

  it('marks tenantScoped + scope=tenant when the table has a tenant column', () => {
    const spec = inferSpec({
      discovered: makeDiscovered('posts', 'postsRepository'),
      tableMeta: makeTable({ hasTenantColumn: true }),
      validators: makeValidators(),
    });
    expect(spec.tenantScoped).toBe(true);
    expect(spec.scope).toBe('tenant');
  });

  it('falls back to system scope when no tenant column is present', () => {
    const spec = inferSpec({
      discovered: makeDiscovered('tenants', 'tenantsRepository'),
      tableMeta: makeTable({ name: 'tenants', hasTenantColumn: false }),
      validators: makeValidators(),
    });
    expect(spec.tenantScoped).toBe(false);
    expect(spec.scope).toBe('system');
  });

  it('builds search from non-FK text/varchar columns only', () => {
    const spec = inferSpec({
      discovered: makeDiscovered('posts', 'postsRepository'),
      tableMeta: makeTable({
        columns: [
          makeCol({
            name: 'id',
            type: 'uuid',
            isPrimaryKey: true,
            generated: true,
          }),
          makeCol({ name: 'title', type: 'varchar' }),
          makeCol({ name: 'content', type: 'text' }),
          makeCol({
            name: 'authorId',
            type: 'uuid',
            references: { table: 'users', column: 'id' },
          }),
        ],
      }),
      validators: makeValidators(),
    });
    expect(spec.list.search).toEqual(['title', 'content']);
  });
});
