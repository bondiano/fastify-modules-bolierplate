import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

import type { AdminResourceSpec } from '../types.js';

import { createAdminRegistry } from './registry.js';

const makeSpec = (name: string): AdminResourceSpec => ({
  name,
  table: name,
  repositoryKey: `${name}Repository`,
  label: name,
  icon: null,
  fields: [],
  list: {
    columns: [],
    search: [],
    defaultSort: { field: 'id', order: 'desc' },
    sortableFields: [],
  },
  form: { fieldsets: null },
  relations: {},
  rowActions: [],
  permissions: { subject: null },
  hasSoftDelete: false,
  validators: { create: Type.Object({}), update: Type.Object({}) },
});

describe('createAdminRegistry', () => {
  it('lists every spec in insertion order', () => {
    const registry = createAdminRegistry([
      makeSpec('posts'),
      makeSpec('users'),
    ]);
    expect(registry.all().map((s) => s.name)).toEqual(['posts', 'users']);
  });

  it('looks up a spec by name', () => {
    const registry = createAdminRegistry([makeSpec('posts')]);
    expect(registry.get('posts')?.name).toBe('posts');
    expect(registry.get('nope')).toBeUndefined();
  });

  it('getOrThrow throws for unknown names', () => {
    const registry = createAdminRegistry([makeSpec('posts')]);
    expect(() => registry.getOrThrow('nope')).toThrow(/not found/i);
  });
});
