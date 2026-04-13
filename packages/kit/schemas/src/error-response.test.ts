import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { apiErrorResponseSchema } from './error-response.js';

describe('apiErrorResponseSchema', () => {
  it('accepts a full error response', () => {
    const data = {
      statusCode: 404,
      code: 'NOT_FOUND',
      error: 'Not Found',
      message: 'User not found',
      correlationId: 'req-abc',
      subErrors: [{ path: '/email', message: 'Invalid email' }],
    };
    expect(Value.Check(apiErrorResponseSchema, data)).toBe(true);
  });

  it('accepts minimal error response (no optional fields)', () => {
    const data = {
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      error: 'Internal Server Error',
      message: 'Something went wrong',
    };
    expect(Value.Check(apiErrorResponseSchema, data)).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(Value.Check(apiErrorResponseSchema, { statusCode: 400 })).toBe(
      false,
    );
  });

  it('has $id for shared schema registration', () => {
    expect(apiErrorResponseSchema.$id).toBe('ApiErrorResponse');
  });
});
