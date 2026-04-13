/**
 * Test-only helpers for view specs. Kept as `.ts` so vitest + strip-types
 * can import them without a build step.
 */
import { Type } from '@sinclair/typebox';

import type { AdminResourceSpec, FieldSpec } from '../types.js';

export const makeFieldSpec = (
  overrides: Partial<FieldSpec> = {},
): FieldSpec => ({
  name: 'title',
  label: 'Title',
  widget: 'text',
  required: false,
  readOnly: false,
  nullable: true,
  maxLength: null,
  enumValues: null,
  references: null,
  placeholder: null,
  help: null,
  ...overrides,
});

export const makeResourceSpec = (
  overrides: Partial<AdminResourceSpec> = {},
): AdminResourceSpec => {
  const fields = overrides.fields ?? [
    makeFieldSpec({
      name: 'id',
      label: 'ID',
      widget: 'readonly',
      readOnly: true,
    }),
    makeFieldSpec({
      name: 'title',
      label: 'Title',
      required: true,
      maxLength: 120,
    }),
  ];
  return {
    name: 'posts',
    table: 'posts',
    repositoryKey: 'postsRepository',
    label: 'Posts',
    icon: null,
    fields,
    list: {
      columns: ['id', 'title'],
      search: ['title'],
      defaultSort: { field: 'id', order: 'desc' },
      sortableFields: ['id', 'title'],
    },
    form: { fieldsets: null },
    relations: {},
    rowActions: [],
    permissions: { subject: null },
    hasSoftDelete: false,
    validators: {
      create: Type.Object({}),
      update: Type.Object({}),
    },
    ...overrides,
  };
};
