import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  apiErrorEnvelopeSchema,
  apiErrorSchema,
  createListEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  createSuccessResponseSchema,
  ok,
  paginated,
} from './response-envelope.js';

describe('apiErrorSchema', () => {
  it('accepts valid error shape', () => {
    expect(
      Value.Check(apiErrorSchema, {
        statusCode: 400,
        code: 'BAD_REQUEST',
        error: 'Bad Request',
        message: 'Validation Error',
      }),
    ).toBe(true);
  });

  it('accepts optional correlationId and subErrors', () => {
    expect(
      Value.Check(apiErrorSchema, {
        statusCode: 404,
        code: 'NOT_FOUND',
        error: 'Not Found',
        message: 'User not found',
        correlationId: 'req-abc',
        subErrors: [{ path: '/email', message: 'required' }],
      }),
    ).toBe(true);
  });

  it('rejects missing code', () => {
    expect(
      Value.Check(apiErrorSchema, {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation Error',
      }),
    ).toBe(false);
  });
});

describe('createSuccessResponseSchema', () => {
  const schema = createSuccessResponseSchema(
    Type.Object({ id: Type.String() }),
  );

  it('accepts valid success envelope', () => {
    expect(Value.Check(schema, { data: { id: '123' }, error: null })).toBe(
      true,
    );
  });

  it('rejects missing data', () => {
    expect(Value.Check(schema, { error: null })).toBe(false);
  });

  it('rejects non-null error', () => {
    expect(
      Value.Check(schema, {
        data: { id: '123' },
        error: {
          statusCode: 400,
          code: 'BAD_REQUEST',
          error: 'Bad Request',
          message: 'oops',
        },
      }),
    ).toBe(false);
  });
});

describe('apiErrorEnvelopeSchema', () => {
  it('accepts valid error envelope', () => {
    expect(
      Value.Check(apiErrorEnvelopeSchema, {
        data: null,
        error: {
          statusCode: 404,
          code: 'NOT_FOUND',
          error: 'Not Found',
          message: 'Not found',
        },
      }),
    ).toBe(true);
  });

  it('rejects non-null data', () => {
    expect(
      Value.Check(apiErrorEnvelopeSchema, {
        data: { id: '123' },
        error: {
          statusCode: 404,
          code: 'NOT_FOUND',
          error: 'Not Found',
          message: 'Not found',
        },
      }),
    ).toBe(false);
  });
});

describe('createPaginatedEnvelopeSchema', () => {
  const schema = createPaginatedEnvelopeSchema(
    Type.Object({ id: Type.String() }),
  );

  it('accepts valid paginated envelope', () => {
    expect(
      Value.Check(schema, {
        data: {
          items: [{ id: '1' }, { id: '2' }],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
        },
        error: null,
      }),
    ).toBe(true);
  });

  it('rejects missing pagination', () => {
    expect(
      Value.Check(schema, {
        data: { items: [{ id: '1' }] },
        error: null,
      }),
    ).toBe(false);
  });
});

describe('createListEnvelopeSchema', () => {
  const schema = createListEnvelopeSchema(Type.String());

  it('accepts valid list envelope', () => {
    expect(
      Value.Check(schema, {
        data: { items: ['a', 'b'] },
        error: null,
      }),
    ).toBe(true);
  });
});

describe('ok', () => {
  it('wraps data in success envelope', () => {
    expect(ok({ id: '123' })).toEqual({ data: { id: '123' }, error: null });
  });
});

describe('paginated', () => {
  it('wraps items with pagination in success envelope', () => {
    const result = paginated([{ id: '1' }], 2, 10, 25);
    expect(result).toEqual({
      data: {
        items: [{ id: '1' }],
        pagination: { page: 2, limit: 10, total: 25, totalPages: 3 },
      },
      error: null,
    });
  });
});
