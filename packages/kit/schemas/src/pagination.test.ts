import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  calculatePagination,
  createListResponseSchema,
  createOrderByQuerySchema,
  createPaginatedResponseSchema,
  paginatedQuerySchema,
  paginationSchema,
} from './pagination.js';

describe('paginatedQuerySchema', () => {
  it('accepts valid page and limit', () => {
    expect(Value.Check(paginatedQuerySchema, { page: 1, limit: 20 })).toBe(
      true,
    );
  });

  it('applies defaults', () => {
    const result = Value.Default(paginatedQuerySchema, {});
    expect(result).toEqual({ page: 1, limit: 20 });
  });

  it('rejects page < 1', () => {
    expect(Value.Check(paginatedQuerySchema, { page: 0, limit: 10 })).toBe(
      false,
    );
  });

  it('rejects limit > 100', () => {
    expect(Value.Check(paginatedQuerySchema, { page: 1, limit: 101 })).toBe(
      false,
    );
  });
});

describe('createOrderByQuerySchema', () => {
  const sortSchema = createOrderByQuerySchema(['createdAt', 'name']);

  it('accepts valid orderBy field', () => {
    expect(
      Value.Check(sortSchema, { orderBy: 'createdAt', order: 'asc' }),
    ).toBe(true);
  });

  it('rejects invalid orderBy field', () => {
    expect(Value.Check(sortSchema, { orderBy: 'invalid' })).toBe(false);
  });

  it('accepts empty object (both fields optional)', () => {
    expect(Value.Check(sortSchema, {})).toBe(true);
  });
});

describe('paginationSchema', () => {
  it('accepts valid pagination metadata', () => {
    const data = { page: 1, limit: 20, total: 100, totalPages: 5 };
    expect(Value.Check(paginationSchema, data)).toBe(true);
  });
});

describe('createListResponseSchema', () => {
  it('wraps items in an array', () => {
    const schema = createListResponseSchema(Type.String());
    expect(Value.Check(schema, { items: ['a', 'b'] })).toBe(true);
    expect(Value.Check(schema, { items: [1] })).toBe(false);
  });
});

describe('createPaginatedResponseSchema', () => {
  it('includes items and pagination', () => {
    const schema = createPaginatedResponseSchema(Type.Number());
    const data = {
      items: [1, 2, 3],
      pagination: { page: 1, limit: 10, total: 3, totalPages: 1 },
    };
    expect(Value.Check(schema, data)).toBe(true);
  });

  it('rejects missing pagination', () => {
    const schema = createPaginatedResponseSchema(Type.Number());
    expect(Value.Check(schema, { items: [1] })).toBe(false);
  });
});

describe('calculatePagination', () => {
  it('calculates total pages correctly', () => {
    expect(calculatePagination(1, 10, 25)).toEqual({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it('handles zero total', () => {
    expect(calculatePagination(1, 10, 0)).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('handles exact division', () => {
    expect(calculatePagination(2, 10, 20)).toEqual({
      page: 2,
      limit: 10,
      total: 20,
      totalPages: 2,
    });
  });
});
