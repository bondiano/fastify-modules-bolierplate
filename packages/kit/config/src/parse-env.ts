import { z } from 'zod';

type EnvSchema = Record<string, z.ZodTypeAny>;

type InferEnvOutput<T extends EnvSchema> = {
  [K in keyof T]: z.infer<T[K]>;
};

/**
 * Preprocess that coerces `undefined` to `undefined` (skip)
 * but passes actual strings through to the inner schema.
 * This lets Zod `.default()` kick in for missing env vars.
 */
const envPreprocess = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : value),
    schema,
  );

const isMissing = (value: unknown): boolean =>
  value === undefined || value === '';

const formatExpected = (issue: z.ZodIssue): string | undefined => {
  if ('expected' in issue && typeof issue.expected === 'string') {
    return issue.expected;
  }
  return undefined;
};

const formatIssue = (issue: z.ZodIssue, value: unknown): string => {
  const missing = isMissing(value);

  if (missing) {
    const expected = formatExpected(issue);
    return expected ? `missing (expected ${expected})` : 'missing';
  }

  const receivedString =
    typeof value === 'string' ? `"${value}"` : String(value);

  if ('expected' in issue && typeof issue.expected === 'string') {
    return `expected ${issue.expected}, received ${receivedString}`;
  }

  return `${issue.message}, received ${receivedString}`;
};

const formatError = (
  key: string,
  error: z.ZodError,
  value: unknown,
): string => {
  const issues = error.issues.map((issue) => formatIssue(issue, value));
  return `  ✗ ${key}: ${issues.join('; ')}`;
};

export class EnvValidationError extends Error {
  readonly errors: Record<string, z.ZodError>;

  constructor(
    errors: Record<string, z.ZodError>,
    env: Record<string, string | undefined>,
  ) {
    const lines = Object.entries(errors).map(([key, error]) =>
      formatError(key, error, env[key]),
    );
    const count = Object.keys(errors).length;
    const header = `Environment validation failed (${count} ${count === 1 ? 'error' : 'errors'}):`;

    super(`${header}\n\n${lines.join('\n')}\n`);
    this.name = 'EnvValidationError';
    this.errors = errors;
  }
}

/**
 * Parse and validate environment variables against a Zod schema record.
 *
 * - Missing vars with `.default()` get their default.
 * - Missing required vars and invalid values are collected
 *   and thrown as a single `EnvValidationError`.
 */
export const parseEnv = <T extends EnvSchema>(
  env: Record<string, string | undefined>,
  schema: T,
): InferEnvOutput<T> => {
  const result = {} as Record<string, unknown>;
  const errors: Record<string, z.ZodError> = {};

  for (const [key, zodSchema] of Object.entries(schema)) {
    const parsed = envPreprocess(zodSchema).safeParse(env[key]);

    if (parsed.success) {
      result[key] = parsed.data;
    } else {
      errors[key] = parsed.error;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new EnvValidationError(errors, env);
  }

  return result as InferEnvOutput<T>;
};

/**
 * Zod schema for a valid TCP/UDP port number (1-65535).
 * Coerces string input to number.
 */
export const port = () => z.coerce.number().int().min(1).max(65_535);
