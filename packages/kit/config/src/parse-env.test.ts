import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EnvValidationError, parseEnv, port } from './parse-env.js';

describe('parseEnv', () => {
  it('parses string values', () => {
    const result = parseEnv({ FOO: 'bar' }, { FOO: z.string() });
    expect(result.FOO).toBe('bar');
  });

  it('applies defaults for missing vars', () => {
    const result = parseEnv({}, { FOO: z.string().default('fallback') });
    expect(result.FOO).toBe('fallback');
  });

  it('treats empty string as missing (triggers default)', () => {
    const result = parseEnv(
      { FOO: '' },
      { FOO: z.string().default('fallback') },
    );
    expect(result.FOO).toBe('fallback');
  });

  it('coerces numbers from strings', () => {
    const result = parseEnv({ COUNT: '42' }, { COUNT: z.coerce.number() });
    expect(result.COUNT).toBe(42);
  });

  it('supports transforms', () => {
    const result = parseEnv(
      { TAGS: 'a, b, c' },
      { TAGS: z.string().transform((v) => v.split(',').map((s) => s.trim())) },
    );
    expect(result.TAGS).toEqual(['a', 'b', 'c']);
  });
});

const getError = (fn: () => void): EnvValidationError => {
  try {
    fn();
    expect.fail('should throw');
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return error as EnvValidationError;
  }
};

describe('parseEnv error output', () => {
  it('single missing required string', () => {
    const err = getError(() => parseEnv({}, { DATABASE_URL: z.string() }));
    expect(err.message).toMatchInlineSnapshot(`
      "Environment validation failed (1 error):

        ✗ DATABASE_URL: missing (expected string)
      "
    `);
  });

  it('single missing required number', () => {
    const err = getError(() => parseEnv({}, { PORT: z.coerce.number() }));
    expect(err.message).toMatchInlineSnapshot(`
      "Environment validation failed (1 error):

        ✗ PORT: missing (expected number)
      "
    `);
  });

  it('invalid enum value shows all options', () => {
    const err = getError(() =>
      parseEnv(
        { NODE_ENV: 'oops' },
        { NODE_ENV: z.enum(['development', 'production', 'test']) },
      ),
    );
    expect(err.message).toMatchInlineSnapshot(`
      "Environment validation failed (1 error):

        ✗ NODE_ENV: Invalid option: expected one of "development"|"production"|"test", received "oops"
      "
    `);
  });

  it('multiple missing vars collected together', () => {
    const err = getError(() =>
      parseEnv(
        {},
        {
          DATABASE_URL: z.string(),
          REDIS_URL: z.string(),
          JWT_SECRET: z.string(),
        },
      ),
    );
    expect(err.message).toMatchInlineSnapshot(`
      "Environment validation failed (3 errors):

        ✗ DATABASE_URL: missing (expected string)
        ✗ REDIS_URL: missing (expected string)
        ✗ JWT_SECRET: missing (expected string)
      "
    `);
  });

  it('invalid number shows received value', () => {
    const err = getError(() =>
      parseEnv({ PORT: 'abc' }, { PORT: z.coerce.number() }),
    );
    expect(err.message).toMatchInlineSnapshot(`
      "Environment validation failed (1 error):

        ✗ PORT: expected number, received "abc"
      "
    `);
  });

  it('missing enum shows expected options', () => {
    const err = getError(() =>
      parseEnv({}, { NODE_ENV: z.enum(['development', 'production']) }),
    );
    expect(err.message).toMatchInlineSnapshot(`
      "Environment validation failed (1 error):

        ✗ NODE_ENV: missing
      "
    `);
  });

  it('mix of missing and invalid vars', () => {
    const err = getError(() =>
      parseEnv(
        { ENVIRONMENT: 'nope' },
        {
          ENVIRONMENT: z.enum(['development', 'production']),
          DATABASE_URL: z.string(),
        },
      ),
    );
    expect(err.message).toContain('2 errors');
    expect(err.message).toContain('✗ ENVIRONMENT:');
    expect(err.message).toContain('✗ DATABASE_URL:');
  });

  it('exposes individual ZodErrors on .errors', () => {
    const err = getError(() =>
      parseEnv({}, { FOO: z.string(), BAR: z.coerce.number() }),
    );
    expect(Object.keys(err.errors)).toEqual(['FOO', 'BAR']);
    expect(err.errors.FOO.issues.length).toBeGreaterThan(0);
    expect(err.errors.BAR.issues.length).toBeGreaterThan(0);
  });
});

describe('port', () => {
  it('accepts valid port as string', () => {
    expect(port().parse('3000')).toBe(3000);
  });

  it('rejects 0', () => {
    expect(() => port().parse('0')).toThrow();
  });

  it('rejects values above 65535', () => {
    expect(() => port().parse('99999')).toThrow();
  });

  it('rejects non-integer', () => {
    expect(() => port().parse('3.14')).toThrow();
  });
});
