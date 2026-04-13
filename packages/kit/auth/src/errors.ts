/**
 * Auth-specific errors. These mirror the @kit/errors hierarchy shape
 * (`statusCode` + `error` name) so the global error handler can map them to
 * HTTP responses without coupling this package to @kit/errors directly.
 */
export class AuthError extends Error {
  public readonly statusCode: number;
  public readonly error: string;

  constructor(message: string, statusCode: number, error: string) {
    super(message);
    this.name = error;
    this.statusCode = statusCode;
    this.error = error;
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor(message = 'Invalid email or password') {
    super(message, 401, 'InvalidCredentialsError');
  }
}

export class UserAlreadyExistsError extends AuthError {
  constructor(message = 'User with this email already exists') {
    super(message, 409, 'UserAlreadyExistsError');
  }
}

export class InvalidTokenError extends AuthError {
  constructor(message = 'Invalid token') {
    super(message, 401, 'InvalidTokenError');
  }
}

export class ExpiredTokenError extends AuthError {
  constructor(message = 'Token expired') {
    super(message, 401, 'ExpiredTokenError');
  }
}

export class TokenRevokedError extends AuthError {
  constructor(message = 'Token has been revoked') {
    super(message, 401, 'TokenRevokedError');
  }
}

export class UnauthorizedError extends AuthError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UnauthorizedError');
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'ForbiddenError');
  }
}
