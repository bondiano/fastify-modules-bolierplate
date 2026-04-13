/**
 * Plain-string tag instead of `Symbol` so identity survives test isolation
 * boundaries (vitest workers, multiple module copies, etc.).
 */
export const EXCEPTION_BASE_TAG = '__ExceptionBase';

export interface SerializedException {
  statusCode: number;
  code: string;
  error: string;
  message: string;
  correlationId?: string | undefined;
  metadata?: unknown;
  stack?: string | undefined;
  cause?: unknown;
}

/**
 * Base for every kit exception. Carries an HTTP `statusCode` and a stable
 * `error` name so the global Fastify handler can serialize without knowing
 * about specific subclasses.
 *
 * Subclasses set `statusCode` and `error` as `readonly` instance fields.
 */
export abstract class ExceptionBase extends Error {
  abstract readonly statusCode: number;
  abstract readonly error: string;

  public readonly code: string;
  public override readonly cause?: unknown;
  public readonly metadata?: unknown;
  public readonly correlationId?: string | undefined;
  public readonly [EXCEPTION_BASE_TAG] = 'ExceptionBase' as const;

  constructor(
    message: string,
    options: {
      cause?: unknown;
      metadata?: unknown;
      correlationId?: string;
      code?: string;
    } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    // `code` is resolved after super() so subclass field initializers have run.
    // If `options.code` is provided it takes precedence; otherwise fall back to
    // `defaultCode` (set by subclasses) or derive from the class name.
    this.code = options.code ?? this.getDefaultCode();
    this.cause = options.cause;
    this.metadata = options.metadata;
    this.correlationId = options.correlationId;
  }

  /**
   * Override in subclasses to provide a default machine-readable error code.
   * Defaults to `'INTERNAL_SERVER_ERROR'`.
   */
  protected getDefaultCode(): string {
    return 'INTERNAL_SERVER_ERROR';
  }

  toJSON(): SerializedException {
    return {
      statusCode: this.statusCode,
      code: this.code,
      error: this.error,
      message: this.message,
      correlationId: this.correlationId,
      metadata: this.metadata,
      stack: this.stack,
      cause: this.cause,
    };
  }
}

export const isExceptionBase = (value: unknown): value is ExceptionBase =>
  typeof value === 'object' && value !== null && EXCEPTION_BASE_TAG in value;
