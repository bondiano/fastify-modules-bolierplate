import pg from 'pg';

/**
 * Subset of PostgreSQL error codes we actively translate into domain errors.
 * Full list: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PostgresErrorCodes = Object.freeze({
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
} as const);

export type PostgresErrorCode =
  (typeof PostgresErrorCodes)[keyof typeof PostgresErrorCodes];

const isPgLiteError = (error: unknown): error is pg.DatabaseError =>
  typeof error === 'object' && error !== null && 'schema' in error;

export const isDatabaseError = (error: unknown): error is pg.DatabaseError =>
  error instanceof pg.DatabaseError || isPgLiteError(error);

export const isUniqueViolation = (error: unknown): error is pg.DatabaseError =>
  isDatabaseError(error) && error.code === PostgresErrorCodes.UNIQUE_VIOLATION;

export const isForeignKeyViolation = (
  error: unknown,
): error is pg.DatabaseError =>
  isDatabaseError(error) &&
  error.code === PostgresErrorCodes.FOREIGN_KEY_VIOLATION;
