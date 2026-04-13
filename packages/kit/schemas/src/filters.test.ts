import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { createFilterQuerySchema, searchQuerySchema } from './filters.js';
import { StringEnum } from './type-helpers.js';

describe('searchQuerySchema', () => {
  it('accepts valid search string', () => {
    expect(Value.Check(searchQuerySchema, { search: 'hello' })).toBe(true);
  });

  it('accepts empty object (search is optional)', () => {
    expect(Value.Check(searchQuerySchema, {})).toBe(true);
  });

  it('rejects empty search string', () => {
    expect(Value.Check(searchQuerySchema, { search: '' })).toBe(false);
  });
});

describe('createFilterQuerySchema', () => {
  const filterSchema = createFilterQuerySchema({
    status: StringEnum(['draft', 'published']),
    authorId: Type.String(),
  });

  it('accepts all filters', () => {
    expect(
      Value.Check(filterSchema, { status: 'draft', authorId: '123' }),
    ).toBe(true);
  });

  it('accepts partial filters', () => {
    expect(Value.Check(filterSchema, { status: 'published' })).toBe(true);
  });

  it('accepts empty object (all optional)', () => {
    expect(Value.Check(filterSchema, {})).toBe(true);
  });

  it('rejects invalid enum value', () => {
    expect(Value.Check(filterSchema, { status: 'invalid' })).toBe(false);
  });
});
