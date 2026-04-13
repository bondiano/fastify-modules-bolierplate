import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

/**
 * Standard API error response schema (inner error shape).
 * Matches the shape produced by `@kit/errors` error handler.
 *
 * @deprecated Use `apiErrorEnvelopeSchema` from `./response-envelope.js` for
 * route definitions. The error handler now wraps responses in a
 * `{ data: null, error: {...} }` envelope. This schema describes the inner
 * error shape and is kept for backward compatibility.
 *
 * Register as a shared schema via `fastify.addSchema(apiErrorResponseSchema)`
 * to reference it from route definitions with `Type.Ref(apiErrorResponseSchema)`.
 */
export const apiErrorResponseSchema = Type.Object(
  {
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
  },
  { $id: 'ApiErrorResponse' },
);

export type ApiErrorResponse = Static<typeof apiErrorResponseSchema>;
