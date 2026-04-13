import { describe, expect, it } from 'vitest';

import type {
  AdminDiscoverable,
  AdminResourceDefinition,
  ColumnMeta,
  PaginatedPage,
  SchemaRegistry,
  TableMeta,
} from '../types.js';

import { buildAdminSpecs } from './build-specs.js';

const idColumn: ColumnMeta = {
  name: 'id',
  rawName: 'id',
  type: 'uuid',
  nullable: false,
  generated: true,
  defaultValue: null,
  enumValues: null,
  references: null,
  isPrimaryKey: true,
  maxLength: null,
};

const titleColumn: ColumnMeta = {
  name: 'title',
  rawName: 'title',
  type: 'varchar',
  nullable: false,
  generated: false,
  defaultValue: null,
  enumValues: null,
  references: null,
  isPrimaryKey: false,
  maxLength: 200,
};

const postsTable: TableMeta = {
  name: 'posts',
  columns: [idColumn, titleColumn],
  primaryKey: ['id'],
  hasSoftDelete: false,
};

const makeRegistry = (tables: readonly TableMeta[]): SchemaRegistry => ({
  get: (name) => tables.find((t) => t.name === name),
  all: () => tables,
});

const makeRepo = (table: string): AdminDiscoverable => ({
  table,
  findPaginatedByPage: async (): Promise<PaginatedPage<unknown>> => ({
    items: [],
    total: 0,
  }),
  findById: async () => {},
  create: async (data) => data,
  update: async () => {},
  deleteById: async () => {},
});

describe('buildAdminSpecs', () => {
  it('builds a spec for each discovered repository with schema meta', async () => {
    const cradle = { postsRepository: makeRepo('posts') };
    const { specs, repos } = await buildAdminSpecs({
      cradle,
      schemaRegistry: makeRegistry([postsTable]),
      overrides: [],
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]?.name).toBe('posts');
    expect(specs[0]?.fields.map((f) => f.name)).toContain('title');
    expect(repos.get('posts')).toBeDefined();
  });

  it('skips repositories without schema meta and warns', async () => {
    const cradle = {
      postsRepository: makeRepo('posts'),
      orphanRepository: makeRepo('orphan'),
    };
    const warnings: Array<{ obj: unknown; msg: string }> = [];
    const { specs } = await buildAdminSpecs({
      cradle,
      schemaRegistry: makeRegistry([postsTable]),
      overrides: [],
      logger: {
        warn: (object, message) => warnings.push({ obj: object, msg: message }),
      },
    });
    expect(specs.map((s) => s.name)).toEqual(['posts']);
    expect(warnings).toHaveLength(1);
  });

  it('applies override label and widgets', async () => {
    const override: AdminResourceDefinition = {
      table: 'posts',
      factory: () => ({
        label: 'Blog Posts',
        widgets: { title: 'textarea' },
      }),
    };
    const { specs } = await buildAdminSpecs({
      cradle: { postsRepository: makeRepo('posts') },
      schemaRegistry: makeRegistry([postsTable]),
      overrides: [override],
    });
    const spec = specs[0]!;
    expect(spec.label).toBe('Blog Posts');
    const titleField = spec.fields.find((f) => f.name === 'title');
    expect(titleField?.widget).toBe('textarea');
  });

  it('resolves async relation factories in overrides', async () => {
    const override: AdminResourceDefinition = {
      table: 'posts',
      factory: () => ({
        relations: {
          author: async () => ({ resource: 'users', display: 'email' }),
        },
      }),
    };
    const { specs } = await buildAdminSpecs({
      cradle: { postsRepository: makeRepo('posts') },
      schemaRegistry: makeRegistry([postsTable]),
      overrides: [override],
    });
    expect(specs[0]?.relations['author']).toEqual({
      resource: 'users',
      display: 'email',
    });
  });
});
