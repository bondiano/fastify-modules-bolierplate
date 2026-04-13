import { Type } from '@sinclair/typebox';
import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  bulkDeleteResponseSchema,
  bulkIdsSchema,
  bulkUpdateResponseSchema,
  createBulkUpdateSchema,
} from './bulk.js';

// Register UUID format for Value.Check validation in tests.
FormatRegistry.Set('uuid', (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
);

const uuid = '550e8400-e29b-41d4-a716-446655440000';

describe('bulkIdsSchema', () => {
  it('accepts valid IDs array', () => {
    expect(Value.Check(bulkIdsSchema, { ids: [uuid] })).toBe(true);
  });

  it('rejects empty IDs array', () => {
    expect(Value.Check(bulkIdsSchema, { ids: [] })).toBe(false);
  });

  it('rejects non-UUID strings', () => {
    expect(Value.Check(bulkIdsSchema, { ids: ['not-a-uuid'] })).toBe(false);
  });
});

describe('createBulkUpdateSchema', () => {
  const schema = createBulkUpdateSchema(Type.Object({ status: Type.String() }));

  it('accepts valid bulk update body', () => {
    expect(
      Value.Check(schema, { ids: [uuid], data: { status: 'active' } }),
    ).toBe(true);
  });

  it('rejects missing data', () => {
    expect(Value.Check(schema, { ids: [uuid] })).toBe(false);
  });
});

describe('bulkDeleteResponseSchema', () => {
  it('accepts success envelope with deletedCount', () => {
    expect(
      Value.Check(bulkDeleteResponseSchema, {
        data: { deletedCount: 5 },
        error: null,
      }),
    ).toBe(true);
  });
});

describe('bulkUpdateResponseSchema', () => {
  it('accepts success envelope with updatedCount', () => {
    expect(
      Value.Check(bulkUpdateResponseSchema, {
        data: { updatedCount: 3 },
        error: null,
      }),
    ).toBe(true);
  });
});
