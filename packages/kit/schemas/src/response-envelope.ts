import { Type } from '@sinclair/typebox';
import type { Static, TSchema } from '@sinclair/typebox';

import {
  calculatePagination,
  createListResponseSchema,
  createPaginatedResponseSchema,
} from './pagination.js';
import type { Pagination } from './pagination.js';

/**
 * Inner error shape for the response envelope.
 * Matches the structure produced by `@kit/errors` error handler.
 */
export const apiErrorSchema = Type.Object({
  statusCode: Type.Number({ example: 400 }),
  code: Type.String({
    example: 'BAD_REQUEST',
    description: 'Machine-readable error code in SCREAMING_SNAKE_CASE',
  }),
  error: Type.String({ example: 'Bad Request' }),
  message: Type.String({ example: 'Validation Error' }),
  correlationId: Type.Optional(
    Type.String({
      example: 'req-abc',
      description: 'Correlation ID for error tracking',
    }),
  ),
  subErrors: Type.Optional(
    Type.Array(
      Type.Object({
        path: Type.String(),
        message: Type.String(),
      }),
    ),
  ),
});

export type ApiError = Static<typeof apiErrorSchema>;

/**
 * Creates a success response envelope schema: `{ data: T, error: null }`.
 *
 * @example
 * ```ts
 * schema: { response: { 200: createSuccessResponseSchema(userSchema) } }
 * ```
 */
export const createSuccessResponseSchema = <T extends TSchema>(dataSchema: T) =>
  Type.Object({
    data: dataSchema,
    error: Type.Null(),
  });

/**
 * Error response envelope schema: `{ data: null, error: ApiError }`.
 * Registered as shared schema with `$id: 'ApiErrorEnvelope'`.
 *
 * @example
 * ```ts
 * schema: { response: { 400: apiErrorEnvelopeSchema } }
 * ```
 */
export const apiErrorEnvelopeSchema = Type.Object(
  {
    data: Type.Null(),
    error: apiErrorSchema,
  },
  { $id: 'ApiErrorEnvelope' },
);

export type ApiErrorEnvelope = Static<typeof apiErrorEnvelopeSchema>;

/**
 * Creates a union of success and error envelope for OpenAPI documentation.
 * Prefer using `createSuccessResponseSchema` on 2xx and `apiErrorEnvelopeSchema`
 * on 4xx/5xx separately in route definitions for clearer OpenAPI output.
 */
export const createResponseSchema = <T extends TSchema>(dataSchema: T) =>
  Type.Union([createSuccessResponseSchema(dataSchema), apiErrorEnvelopeSchema]);

// --- Response helpers for route handlers ---

/**
 * Wrap a single resource in the success envelope.
 *
 * @example
 * ```ts
 * handler: async (request) => {
 *   const user = await usersService.findById(request.params.id);
 *   return ok(user);
 * }
 * ```
 */
export const ok = <T>(data: T): { data: T; error: null } => ({
  data,
  error: null,
});

/**
 * Wrap paginated results in the success envelope.
 *
 * @example
 * ```ts
 * handler: async (request) => {
 *   const { page, limit } = request.query;
 *   const { items, total } = await usersService.findPaginated({ page, limit });
 *   return paginated(items, page, limit, total);
 * }
 * ```
 */
export const paginated = <T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
): { data: { items: T[]; pagination: Pagination }; error: null } => ({
  data: {
    items,
    pagination: calculatePagination(page, limit, total),
  },
  error: null,
});

// --- Envelope schema factories for route definitions ---

/**
 * Creates a paginated response wrapped in the `{ data, error }` envelope.
 *
 * @example
 * ```ts
 * schema: { response: { 200: createPaginatedEnvelopeSchema(userSchema) } }
 * ```
 */
export const createPaginatedEnvelopeSchema = <T extends TSchema>(item: T) =>
  createSuccessResponseSchema(createPaginatedResponseSchema(item));

/**
 * Creates a list response wrapped in the `{ data, error }` envelope.
 *
 * @example
 * ```ts
 * schema: { response: { 200: createListEnvelopeSchema(userSchema) } }
 * ```
 */
export const createListEnvelopeSchema = <T extends TSchema>(item: T) =>
  createSuccessResponseSchema(createListResponseSchema(item));
