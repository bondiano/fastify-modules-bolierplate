import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

import type {
  AdminResourceOverride,
  AdminResourceSpec,
  FieldSpec,
  RelationDescriptor,
  RowAction,
} from '../types.js';

import { mergeOverrides } from './merge-overrides.js';

const field = (overrides: Partial<FieldSpec> = {}): FieldSpec => ({
  name: 'title',
  label: 'Title',
  widget: 'text',
  required: true,
  readOnly: false,
  nullable: false,
  maxLength: 200,
  enumValues: null,
  references: null,
  placeholder: null,
  help: null,
  ...overrides,
});

const makeSpec = (): AdminResourceSpec => ({
  name: 'posts',
  table: 'posts',
  repositoryKey: 'postsRepository',
  label: 'Posts',
  icon: null,
  fields: [
    field({ name: 'id', widget: 'readonly', readOnly: true }),
    field({ name: 'title' }),
    field({ name: 'content', widget: 'text' }),
    field({
      name: 'deletedAt',
      widget: 'datetime',
      nullable: true,
      required: false,
    }),
  ],
  list: {
    columns: ['id', 'title', 'content', 'deletedAt'],
    search: ['title', 'content'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['id', 'title', 'content'],
    filters: [],
  },
  form: { fieldsets: null },
  relations: {},
  rowActions: [],
  permissions: { subject: 'Post' },
  hasSoftDelete: true,
  tenantScoped: false,
  scope: 'system',
  group: null,
  detailActions: [],
  sensitiveColumns: [],
  auditEnabled: true,
  readOnlyResource: false,
  validators: { create: Type.Object({}), update: Type.Object({}) },
});

const emptyRelations: Readonly<Record<string, RelationDescriptor>> = {};

describe('mergeOverrides', () => {
  it('returns a structurally equal spec when override is undefined', () => {
    const spec = makeSpec();
    const merged = mergeOverrides(spec, undefined, emptyRelations);
    expect(merged).toEqual(spec);
  });

  it('replaces label and icon when set', () => {
    const override: AdminResourceOverride = {
      label: 'Blog Posts',
      icon: 'file-text',
    };
    const merged = mergeOverrides(makeSpec(), override, emptyRelations);
    expect(merged.label).toBe('Blog Posts');
    expect(merged.icon).toBe('file-text');
  });

  it('drops hidden fields from fields and list.columns', () => {
    const override: AdminResourceOverride = { hidden: ['deletedAt'] };
    const merged = mergeOverrides(makeSpec(), override, emptyRelations);
    expect(merged.fields.map((f) => f.name)).not.toContain('deletedAt');
    expect(merged.list.columns).not.toContain('deletedAt');
  });

  it('applies widgets to the right fields', () => {
    const override: AdminResourceOverride = {
      widgets: { content: 'textarea' },
    };
    const merged = mergeOverrides(makeSpec(), override, emptyRelations);
    const content = merged.fields.find((f) => f.name === 'content')!;
    expect(content.widget).toBe('textarea');
    // Unrelated field untouched.
    expect(merged.fields.find((f) => f.name === 'title')!.widget).toBe('text');
  });

  it('ignores widgets pointing at non-existent fields', () => {
    const override: AdminResourceOverride = { widgets: { nope: 'textarea' } };
    const merged = mergeOverrides(makeSpec(), override, emptyRelations);
    expect(merged.fields.map((f) => f.name)).toEqual([
      'id',
      'title',
      'content',
      'deletedAt',
    ]);
  });

  it('sets readOnly on listed fields', () => {
    const override: AdminResourceOverride = { readOnly: ['id', 'title'] };
    const merged = mergeOverrides(makeSpec(), override, emptyRelations);
    expect(merged.fields.find((f) => f.name === 'id')!.readOnly).toBe(true);
    expect(merged.fields.find((f) => f.name === 'title')!.readOnly).toBe(true);
    expect(merged.fields.find((f) => f.name === 'content')!.readOnly).toBe(
      false,
    );
  });

  it('replaces list.columns wholesale when list.columns is set', () => {
    const override: AdminResourceOverride = { list: { columns: ['title'] } };
    const merged = mergeOverrides(makeSpec(), override, emptyRelations);
    expect(merged.list.columns).toEqual(['title']);
    // Other list properties untouched.
    expect(merged.list.search).toEqual(['title', 'content']);
  });

  it('appends row actions to the inferred list', () => {
    const action: RowAction = {
      label: 'Publish',
      run: async () => {},
    };
    const override: AdminResourceOverride = { rowActions: [action] };
    const merged = mergeOverrides(makeSpec(), override, emptyRelations);
    expect(merged.rowActions).toHaveLength(1);
    expect(merged.rowActions[0]!.label).toBe('Publish');
  });

  it('merges resolved relations into the spec', () => {
    const resolved: Readonly<Record<string, RelationDescriptor>> = {
      authorId: { resource: 'users', display: 'email' },
    };
    const merged = mergeOverrides(makeSpec(), {}, resolved);
    expect(merged.relations['authorId']).toEqual({
      resource: 'users',
      display: 'email',
    });
  });

  it('replaces permissions.subject when provided', () => {
    const merged = mergeOverrides(
      makeSpec(),
      { permissions: { subject: 'Article' } },
      emptyRelations,
    );
    expect(merged.permissions.subject).toBe('Article');
  });

  it('passes tenantScoped + scope through unchanged when override is empty', () => {
    const spec = makeSpec();
    const merged = mergeOverrides(
      { ...spec, tenantScoped: true, scope: 'tenant' },
      {},
      emptyRelations,
    );
    expect(merged.tenantScoped).toBe(true);
    expect(merged.scope).toBe('tenant');
  });

  it('lets the override force tenantScoped: false and clears scope to system', () => {
    const spec = {
      ...makeSpec(),
      tenantScoped: true,
      scope: 'tenant' as const,
    };
    const merged = mergeOverrides(
      spec,
      { tenantScoped: false },
      emptyRelations,
    );
    expect(merged.tenantScoped).toBe(false);
    expect(merged.scope).toBe('system');
  });

  it('lets the override pin scope independently of tenantScoped', () => {
    const spec = {
      ...makeSpec(),
      tenantScoped: true,
      scope: 'tenant' as const,
    };
    const merged = mergeOverrides(spec, { scope: 'system' }, emptyRelations);
    // tenantScoped flag is unchanged but the resource is rendered at the
    // system level (e.g. a cross-tenant analytics view).
    expect(merged.tenantScoped).toBe(true);
    expect(merged.scope).toBe('system');
  });

  it("defaults to the inferred `group` (null) when override doesn't touch it", () => {
    const spec = makeSpec();
    const merged = mergeOverrides(spec, {}, emptyRelations);
    expect(merged.group).toBeNull();
  });

  it('lets an override set `group` to a label', () => {
    const spec = makeSpec();
    const merged = mergeOverrides(spec, { group: 'Tenancy' }, emptyRelations);
    expect(merged.group).toBe('Tenancy');
  });

  it('lets an override force `group: null` to un-group an inferred-grouped spec', () => {
    const spec = { ...makeSpec(), group: 'Tenancy' as string | null };
    const merged = mergeOverrides(spec, { group: null }, emptyRelations);
    expect(merged.group).toBeNull();
  });

  it('does not mutate the input spec', () => {
    const spec = makeSpec();
    const before = structuredClone({ ...spec, validators: undefined });
    mergeOverrides(spec, { hidden: ['deletedAt'], label: 'X' }, emptyRelations);
    const after = structuredClone({ ...spec, validators: undefined });
    expect(after).toEqual(before);
  });
});
