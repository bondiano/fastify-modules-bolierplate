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

// -------------------------------------------------------------------------
// Token-based flow errors (password reset / email verify / OTP)
// -------------------------------------------------------------------------

/**
 * Thrown when `confirmPasswordReset` / `confirmEmailVerification` /
 * `verifyOtp` receive a token / code that doesn't match a live row.
 * Callers MUST NOT distinguish between "no such token", "expired", and
 * "already used" -- doing so leaks whether a value was ever valid. The
 * three cases collapse into a single 401 with the same message.
 */
export class InvalidTokenFlowError extends AuthError {
  constructor(message = 'Invalid or expired token') {
    super(message, 401, 'InvalidTokenFlowError');
  }
}

/** Thrown when a verified email is required but the user hasn't verified. */
export class EmailNotVerifiedError extends AuthError {
  constructor(message = 'Email verification required') {
    super(message, 403, 'EmailNotVerifiedError');
  }
}

/**
 * Thrown when an OTP exceeds `OTP_MAX_ATTEMPTS`. The caller should
 * present this as "too many attempts; request a new code" -- the
 * underlying row is marked used and any further verify attempts return
 * `InvalidTokenFlowError` until a fresh request lands.
 */
export class OtpLockedOutError extends AuthError {
  constructor(message = 'Too many failed attempts; request a new code') {
    super(message, 429, 'OtpLockedOutError');
  }
}
