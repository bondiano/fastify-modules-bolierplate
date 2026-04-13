import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineDomainError, NotFoundException } from '@kit/errors';

import { runEffect, toException } from './run.js';

class UserNotFound extends defineDomainError(
  'UserNotFound',
  NotFoundException,
) {
  constructor(public readonly userId: string) {
    super(`User ${userId} not found`);
  }
}

describe('runEffect', () => {
  it('resolves on success', async () => {
    await expect(runEffect(Effect.succeed(42))).resolves.toBe(42);
  });

  it('maps typed DomainError failure to its exception', async () => {
    await expect(
      runEffect(Effect.fail(new UserNotFound('1'))),
    ).rejects.toMatchObject({
      statusCode: 404,
      error: 'Not Found',
    });
  });

  it('maps defects to 500', async () => {
    await expect(
      runEffect(Effect.die(new Error('boom'))),
    ).rejects.toMatchObject({
      statusCode: 500,
    });
  });
});

describe('toException', () => {
  it('passes ExceptionBase through', () => {
    const error = new NotFoundException('x');
    expect(toException(error)).toBe(error);
  });
});
