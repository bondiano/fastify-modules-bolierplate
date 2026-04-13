import { Cause, Chunk, Effect, Exit } from 'effect';

import {
  isDomainError,
  isExceptionBase,
  InternalServerErrorException,
  type ExceptionBase,
} from '@kit/errors';

/**
 * Coerce any failure value (typed `E`, defect, or unknown) into an
 * `ExceptionBase` using the same rules the `@kit/errors` Fastify handler
 * applies to thrown values.
 */
export const toException = (value: unknown): ExceptionBase => {
  if (isExceptionBase(value)) return value;
  if (isDomainError(value)) return value.toException();
  if (value instanceof Error) {
    return new InternalServerErrorException(value.message, { cause: value });
  }
  return new InternalServerErrorException('Internal Server Error', {
    cause: value,
  });
};

/**
 * Run an Effect to a Promise that resolves on success and rejects with an
 * `ExceptionBase` on either typed failure or defect. The thrown exception
 * flows through the standard `@kit/errors` Fastify error handler.
 */
export const runEffect = async <A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.failureOption(exit.cause);
  if (failure._tag === 'Some') {
    throw toException(failure.value);
  }
  const firstDefect = Chunk.head(Cause.defects(exit.cause));
  throw toException(
    firstDefect._tag === 'Some'
      ? firstDefect.value
      : new Error(Cause.pretty(exit.cause)),
  );
};
