import { ExceptionBase } from './exception-base.js';

type ExceptionOptions = {
  cause?: unknown;
  metadata?: unknown;
  correlationId?: string;
  code?: string;
};

/** 400 -- malformed input, missing required field, invalid argument. */
export class BadRequestException extends ExceptionBase {
  readonly statusCode = 400;
  readonly error = 'Bad Request';
  protected override getDefaultCode() {
    return 'BAD_REQUEST';
  }
  constructor(message = 'Bad Request', options?: ExceptionOptions) {
    super(message, options);
  }
}

/** 401 -- caller is unauthenticated or token is invalid/expired. */
export class UnauthorizedException extends ExceptionBase {
  readonly statusCode = 401;
  readonly error = 'Unauthorized';
  protected override getDefaultCode() {
    return 'UNAUTHORIZED';
  }
  constructor(message = 'Unauthorized', options?: ExceptionOptions) {
    super(message, options);
  }
}

/** 403 -- authenticated but lacks permission for the action. */
export class ForbiddenException extends ExceptionBase {
  readonly statusCode = 403;
  readonly error = 'Forbidden';
  protected override getDefaultCode() {
    return 'FORBIDDEN';
  }
  constructor(message = 'Forbidden', options?: ExceptionOptions) {
    super(message, options);
  }
}

/** 404 -- resource does not exist. */
export class NotFoundException extends ExceptionBase {
  readonly statusCode = 404;
  readonly error = 'Not Found';
  protected override getDefaultCode() {
    return 'NOT_FOUND';
  }
  constructor(message = 'Not Found', options?: ExceptionOptions) {
    super(message, options);
  }
}

/** 409 -- duplicate resource or state conflict. */
export class ConflictException extends ExceptionBase {
  readonly statusCode = 409;
  readonly error = 'Conflict';
  protected override getDefaultCode() {
    return 'CONFLICT';
  }
  constructor(message = 'Conflict', options?: ExceptionOptions) {
    super(message, options);
  }
}

/** 422 -- request was understood but business rule rejected it. */
export class UnprocessableEntityException extends ExceptionBase {
  readonly statusCode = 422;
  readonly error = 'Unprocessable Entity';
  protected override getDefaultCode() {
    return 'UNPROCESSABLE_ENTITY';
  }
  constructor(message = 'Unprocessable Entity', options?: ExceptionOptions) {
    super(message, options);
  }
}

/** 429 -- rate limit exceeded. */
export class TooManyRequestsException extends ExceptionBase {
  readonly statusCode = 429;
  readonly error = 'Too Many Requests';
  protected override getDefaultCode() {
    return 'TOO_MANY_REQUESTS';
  }
  constructor(message = 'Too Many Requests', options?: ExceptionOptions) {
    super(message, options);
  }
}

/** 500 -- catch-all for unexpected failures. */
export class InternalServerErrorException extends ExceptionBase {
  readonly statusCode = 500;
  readonly error = 'Internal Server Error';
  constructor(message = 'Internal Server Error', options?: ExceptionOptions) {
    super(message, options);
  }
}
