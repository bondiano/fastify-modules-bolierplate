import type { ExceptionBase } from './exception-base.js';
import { InternalServerErrorException } from './exceptions.js';

/**
 * Tag used by ts-pattern. Every domain error sets `_tag` to its class name so
 * `match(error).with({ _tag: 'UserNotFound' }, ...)` is exhaustive.
 */
export const DOMAIN_ERROR_TAG = '__DomainError';

/**
 * Base class for railway-style domain errors. Use these inside services that
 * return `Result<T, DomainError>` (neverthrow) or `Effect<A, DomainError>`.
 *
 * Each subclass declares:
 *   - `_tag`: discriminator for ts-pattern
 *   - `toException()`: how to map this error to an HTTP exception when it
 *     escapes the railway via the Fastify error handler
 *
 * The default `toException()` returns 500. Override per subclass.
 */
export abstract class DomainError extends Error {
  abstract readonly _tag: string;
  public readonly [DOMAIN_ERROR_TAG] = 'DomainError' as const;
  public readonly metadata?: unknown;

  constructor(
    message: string,
    options: { cause?: unknown; metadata?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.metadata = options.metadata;
  }

  /**
   * Map this domain error to an HTTP exception. Override per subclass to
   * return e.g. `new NotFoundException(this.message)`.
   */
  toException(): ExceptionBase {
    return new InternalServerErrorException(this.message, {
      cause: this,
      metadata: this.metadata,
    });
  }
}

export const isDomainError = (value: unknown): value is DomainError =>
  typeof value === 'object' && value !== null && DOMAIN_ERROR_TAG in value;

/**
 * Convenience factory: build a tagged DomainError subclass with a fixed
 * `_tag` and a default exception constructor. Keeps repetitive subclasses
 * one-liners while still producing real classes that ts-pattern can narrow.
 *
 * @example
 *   export class UserNotFound extends defineDomainError('UserNotFound', NotFoundException) {
 *     constructor(public readonly userId: string) {
 *       super(`User ${userId} not found`);
 *     }
 *   }
 */
export const defineDomainError = <Tag extends string>(
  tag: Tag,
  ExceptionCtor: new (
    message: string,
    options?: { cause?: unknown; metadata?: unknown; code?: string },
  ) => ExceptionBase = InternalServerErrorException,
  defaultCode?: string,
) => {
  abstract class TaggedDomainError extends DomainError {
    readonly _tag = tag;
    override toException(): ExceptionBase {
      return new ExceptionCtor(this.message, {
        cause: this,
        metadata: this.metadata,
        ...(defaultCode ? { code: defaultCode } : {}),
      });
    }
  }
  // Strip `abstract` so callers can `extends defineDomainError(...)` and
  // instantiate directly when no extra fields are needed.
  return TaggedDomainError as unknown as new (
    message: string,
    options?: { cause?: unknown; metadata?: unknown },
  ) => DomainError & { readonly _tag: Tag };
};
