import { describe, expect, it } from 'vitest';

import { defineDomainError, type DomainError } from './domain-error.js';
import { isExceptionBase } from './exception-base.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from './exceptions.js';
import { createErrorHandler } from './handler.js';

describe('exceptions', () => {
  it('carries statusCode and error name', () => {
    const error = new NotFoundException('user 1');
    expect(error.statusCode).toBe(404);
    expect(error.error).toBe('Not Found');
    expect(isExceptionBase(error)).toBe(true);
  });

  it('has a default code matching the exception type', () => {
    expect(new BadRequestException().code).toBe('BAD_REQUEST');
    expect(new NotFoundException().code).toBe('NOT_FOUND');
    expect(new ConflictException().code).toBe('CONFLICT');
  });

  it('allows overriding the code via options', () => {
    const error = new ConflictException('Email taken', {
      code: 'EMAIL_ALREADY_EXISTS',
    });
    expect(error.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(error.statusCode).toBe(409);
  });

  it('includes code in toJSON output', () => {
    const error = new NotFoundException('user 1', { code: 'USER_NOT_FOUND' });
    const json = error.toJSON();
    expect(json.code).toBe('USER_NOT_FOUND');
  });
});

class UserNotFound extends defineDomainError(
  'UserNotFound',
  NotFoundException,
) {
  constructor(public readonly userId: string) {
    super(`User ${userId} not found`);
  }
}

class EmailTaken extends defineDomainError(
  'EmailTaken',
  ConflictException,
  'EMAIL_TAKEN',
) {
  constructor(public readonly email: string) {
    super(`Email ${email} already taken`);
  }
}

describe('domain errors', () => {
  it('mapping to exception preserves statusCode', () => {
    const error = new UserNotFound('42').toException();
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('User 42 not found');
  });

  it('exposes a stable _tag for pattern matching', () => {
    const error: UserNotFound | EmailTaken = new EmailTaken('a@b.c');
    expect(error._tag).toBe('EmailTaken');
  });

  it('passes defaultCode to exception via defineDomainError', () => {
    const exception = new EmailTaken('a@b.c').toException();
    expect(exception.code).toBe('EMAIL_TAKEN');
  });

  it('falls back to exception defaultCode when no code in defineDomainError', () => {
    const exception = new UserNotFound('42').toException();
    expect(exception.code).toBe('NOT_FOUND');
  });
});

const buildReply = () => {
  const calls: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      calls.status = code;
      return reply;
    },
    send(body: unknown) {
      calls.body = body;
      return reply;
    },
  };
  return { reply, calls };
};

describe('handler', () => {
  const fakeRequest = { id: 'req-1', log: { error() {}, debug() {} } };

  it('serializes ExceptionBase with code in { data, error } envelope', () => {
    const handler = createErrorHandler();
    const { reply, calls } = buildReply();
    handler(
      new BadRequestException('bad'),
      fakeRequest as never,
      reply as never,
    );
    expect(calls.status).toBe(400);
    expect(calls.body).toMatchObject({
      data: null,
      error: {
        statusCode: 400,
        code: 'BAD_REQUEST',
        error: 'Bad Request',
        message: 'bad',
        correlationId: 'req-1',
      },
    });
  });

  it('serializes custom error code in envelope', () => {
    const handler = createErrorHandler();
    const { reply, calls } = buildReply();
    handler(
      new ConflictException('Email taken', { code: 'EMAIL_ALREADY_EXISTS' }),
      fakeRequest as never,
      reply as never,
    );
    expect(calls.status).toBe(409);
    expect(calls.body).toMatchObject({
      data: null,
      error: { statusCode: 409, code: 'EMAIL_ALREADY_EXISTS' },
    });
  });

  it('maps escaped DomainError via toException in envelope', () => {
    const handler = createErrorHandler();
    const { reply, calls } = buildReply();
    handler(new UserNotFound('99'), fakeRequest as never, reply as never);
    expect(calls.status).toBe(404);
    expect(calls.body).toMatchObject({
      data: null,
      error: {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'User 99 not found',
      },
    });
  });

  it('maps DomainError with custom code via defineDomainError', () => {
    const handler = createErrorHandler();
    const { reply, calls } = buildReply();
    handler(new EmailTaken('a@b.c'), fakeRequest as never, reply as never);
    expect(calls.status).toBe(409);
    expect(calls.body).toMatchObject({
      data: null,
      error: { statusCode: 409, code: 'EMAIL_TAKEN' },
    });
  });

  it('falls back to 500 with INTERNAL_SERVER_ERROR code for unknown errors', () => {
    const handler = createErrorHandler();
    const { reply, calls } = buildReply();
    handler(new Error('boom'), fakeRequest as never, reply as never);
    expect(calls.status).toBe(500);
    expect(calls.body).toMatchObject({
      data: null,
      error: { statusCode: 500, code: 'INTERNAL_SERVER_ERROR' },
    });
  });
});

// Compile-time sanity: DomainError subclasses really are DomainError.
const _typeCheck: DomainError = new UserNotFound('x');
void _typeCheck;
