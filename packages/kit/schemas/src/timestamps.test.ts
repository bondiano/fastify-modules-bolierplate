import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  baseEntitySchema,
  idSchema,
  softDeletableEntitySchema,
  softDeleteTimestampSchema,
  timestampsSchema,
} from './timestamps.js';

// Register formats so Value.Check recognizes them.
// In production Fastify's ajv handles this; in tests we need it explicitly.
FormatRegistry.Set('date-time', (v) => !Number.isNaN(Date.parse(v)));
FormatRegistry.Set('uuid', (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
);

describe('timestampsSchema', () => {
  it('accepts valid timestamps', () => {
    expect(
      Value.Check(timestampsSchema, {
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(
      Value.Check(timestampsSchema, { createdAt: '2026-01-01T00:00:00.000Z' }),
    ).toBe(false);
  });
});

describe('softDeleteTimestampSchema', () => {
  it('accepts null deletedAt', () => {
    expect(Value.Check(softDeleteTimestampSchema, { deletedAt: null })).toBe(
      true,
    );
  });

  it('accepts datetime deletedAt', () => {
    expect(
      Value.Check(softDeleteTimestampSchema, {
        deletedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(true);
  });
});

describe('idSchema', () => {
  it('accepts valid UUID', () => {
    expect(
      Value.Check(idSchema, { id: '550e8400-e29b-41d4-a716-446655440000' }),
    ).toBe(true);
  });

  it('rejects non-UUID string', () => {
    expect(Value.Check(idSchema, { id: 'not-a-uuid' })).toBe(false);
  });
});

describe('baseEntitySchema', () => {
  it('accepts id + timestamps', () => {
    expect(
      Value.Check(baseEntitySchema, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('rejects missing id', () => {
    expect(
      Value.Check(baseEntitySchema, {
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});

describe('softDeletableEntitySchema', () => {
  it('accepts base entity + null deletedAt', () => {
    expect(
      Value.Check(softDeletableEntitySchema, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      }),
    ).toBe(true);
  });

  it('accepts base entity + datetime deletedAt', () => {
    expect(
      Value.Check(softDeletableEntitySchema, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: '2026-06-01T00:00:00.000Z',
      }),
    ).toBe(true);
  });
});
