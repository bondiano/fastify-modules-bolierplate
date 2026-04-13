/**
 * Authz errors. Mirror the @kit/errors hierarchy shape (`statusCode` +
 * `error` name) so the global error handler can map them to HTTP responses
 * without coupling this package to @kit/errors directly.
 */
export class AuthzError extends Error {
  public readonly statusCode: number;
  public readonly error: string;

  constructor(message: string, statusCode: number, error: string) {
    super(message);
    this.name = error;
    this.statusCode = statusCode;
    this.error = error;
  }
}

export class ForbiddenError extends AuthzError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'ForbiddenError');
  }
}

export class UnauthorizedError extends AuthzError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UnauthorizedError');
  }
}
