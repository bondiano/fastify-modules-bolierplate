import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import { isDomainError } from './domain-error.js';
import { isExceptionBase, type SerializedException } from './exception-base.js';
import { InternalServerErrorException } from './exceptions.js';

export interface ErrorResponseBody {
  statusCode: number;
  code?: string;
  error: string;
  message: string;
  correlationId?: string;
  metadata?: unknown;
  subErrors?: Array<{ path: string; message: string }>;
}

export interface CreateErrorHandlerOptions {
  /**
   * Resolve a request correlation id (e.g. from `@fastify/request-context`).
   * Defaults to `request.id`.
   */
  getCorrelationId?: (request: FastifyRequest) => string | undefined;
  /**
   * Hook for translating extra error shapes from libraries the kit doesn't
   * import directly (e.g. Kysely's `NoResultError`). Return `undefined` to
   * fall through to the default mapping.
   */
  mapUnknown?: (error: unknown) => ErrorResponseBody | undefined;
  /**
   * When true, include `stack` on the response (development only).
   */
  exposeStack?: boolean;
}

const fromFastifyError = (
  error: FastifyError,
): ErrorResponseBody | undefined => {
  if (error.code === 'FST_ERR_VALIDATION') {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      error: 'Bad Request',
      message: 'Validation error',
      subErrors: (error.validation ?? []).map((v) => ({
        path: v.instancePath,
        message: v.message ?? '',
      })),
    };
  }
  if (error.code === 'FST_ERR_NOT_FOUND') {
    return {
      statusCode: 404,
      code: 'NOT_FOUND',
      error: 'Not Found',
      message: 'Not Found',
    };
  }
  if (
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 600
  ) {
    return {
      statusCode: error.statusCode,
      code: error.code ?? 'UNKNOWN_ERROR',
      error: error.name || 'Error',
      message: error.message,
    };
  }
  return undefined;
};

/**
 * Build the Fastify `setErrorHandler` callback. Maps:
 *   - `ExceptionBase` subclasses              -> their statusCode/error/message
 *   - `DomainError` subclasses (escaped)      -> `.toException()` mapping
 *   - Fastify validation / not-found errors   -> 400 / 404
 *   - Anything else with a numeric statusCode -> as-is
 *   - Everything else                         -> 500
 */
export const createErrorHandler = (options: CreateErrorHandlerOptions = {}) => {
  const getCorrelationId = options.getCorrelationId ?? ((req) => req.id);

  return function errorHandler(
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply {
    const correlationId = getCorrelationId(request);

    let body: ErrorResponseBody;
    let serialized: SerializedException | undefined;

    if (isExceptionBase(error)) {
      serialized = error.toJSON();
      body = {
        statusCode: error.statusCode,
        code: error.code,
        error: error.error,
        message: error.message,
        metadata: error.metadata,
      };
    } else if (isDomainError(error)) {
      const exception = error.toException();
      serialized = exception.toJSON();
      body = {
        statusCode: exception.statusCode,
        code: exception.code,
        error: exception.error,
        message: exception.message,
        metadata: exception.metadata,
      };
    } else {
      const fromFastify =
        error && typeof error === 'object' && 'code' in error
          ? fromFastifyError(error as FastifyError)
          : undefined;
      const fromUser = options.mapUnknown?.(error);
      body = fromFastify ??
        fromUser ?? {
          statusCode: 500,
          code: 'INTERNAL_SERVER_ERROR',
          error: new InternalServerErrorException().error,
          message: 'Internal Server Error',
        };
    }

    body.code ??= 'INTERNAL_SERVER_ERROR';
    if (correlationId) body.correlationId = correlationId;

    if (body.statusCode >= 500) {
      request.log.error(
        { err: error, correlationId },
        'Unhandled request error',
      );
    } else {
      request.log.debug({ err: error, correlationId }, 'Handled request error');
    }

    if (options.exposeStack && serialized?.stack) {
      (body as ErrorResponseBody & { stack?: string }).stack = serialized.stack;
    }

    return reply.status(body.statusCode).send({ data: null, error: body });
  };
};

// Re-export for handler users that want to type-check their `mapUnknown`.

export {
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from './exceptions.js';
