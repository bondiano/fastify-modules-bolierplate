/**
 * Diff + redaction utilities used by the request-scoped audit decorator and
 * (later) by `@kit/admin`'s mutation hook (P2.audit.5). Pure functions, no
 * IO -- the repository is the only side-effect surface of the package.
 */

/** Default redaction patterns. Overridable per-plugin via `redactPatterns`. */
export const DEFAULT_REDACT_PATTERNS: readonly RegExp[] = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /hash/i,
];

/** Replacement value for redacted fields. */
export const REDACTED = '[REDACTED]' as const;

export interface DiffEntry {
  readonly before: unknown;
  readonly after: unknown;
}

export interface DiffResult {
  /** Per-field `{ before, after }` map. NULL when there were no changes
   * (update with identical payload) -- the caller can choose to skip writing
   * an audit row in that case. */
  readonly diff: Record<string, DiffEntry> | null;
  /** True when at least one field name matched the redaction rules and was
   * replaced with `[REDACTED]` in the diff. */
  readonly sensitive: boolean;
}

export interface DiffOptions {
  /** Regex list checked against each field name. Match -> redact. */
  readonly redactPatterns?: readonly RegExp[];
  /** Explicit field names to redact in addition to the pattern match. Useful
   * when a column name doesn't match the default patterns (e.g. `pin`,
   * `mfa_seed`) and the consumer wants to keep the global defaults. */
  readonly sensitiveColumns?: readonly string[];
}

const isRedacted = (
  field: string,
  patterns: readonly RegExp[],
  sensitiveColumns: readonly string[],
): boolean => {
  if (sensitiveColumns.includes(field)) return true;
  for (const pattern of patterns) {
    if (pattern.test(field)) return true;
  }
  return false;
};

/**
 * Shallow diff between `before` and `after`. Semantics:
 * - **create** (`before === null`): every set field becomes `{ before: null, after }`.
 * - **delete** (`after === null`): every set field becomes `{ before, after: null }`.
 * - **update**: per-field comparison via `Object.is`; only changed fields are emitted.
 *
 * Field names matching `redactPatterns` or listed in `sensitiveColumns` get
 * their values replaced with `'[REDACTED]'`; the result's `sensitive` flag
 * is set when any redaction took place. The diff object itself is null when
 * there were no changes (update with identical payload).
 */
export const computeDiff = (
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  options: DiffOptions = {},
): DiffResult => {
  const patterns = options.redactPatterns ?? DEFAULT_REDACT_PATTERNS;
  const sensitiveColumns = options.sensitiveColumns ?? [];

  const out: Record<string, DiffEntry> = {};
  let sensitive = false;

  const fields = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);

  for (const field of fields) {
    const beforeValue = before === null ? null : (before[field] ?? null);
    const afterValue = after === null ? null : (after[field] ?? null);

    // Update: skip unchanged fields. Object.is handles NaN + ±0 correctly;
    // for nested objects this is a deep-equality miss (they always read as
    // changed) -- acceptable for a shallow diff.
    if (
      before !== null &&
      after !== null &&
      Object.is(beforeValue, afterValue)
    ) {
      continue;
    }

    if (isRedacted(field, patterns, sensitiveColumns)) {
      sensitive = true;
      out[field] = {
        before: before === null ? null : REDACTED,
        after: after === null ? null : REDACTED,
      };
    } else {
      out[field] = { before: beforeValue, after: afterValue };
    }
  }

  return {
    diff: Object.keys(out).length === 0 ? null : out,
    sensitive,
  };
};

/**
 * Standalone redactor for arbitrary records (used to scrub `metadata`
 * payloads before they hit the DB). Returns a new object; never mutates.
 */
export const redact = (
  value: Record<string, unknown>,
  options: DiffOptions = {},
): { value: Record<string, unknown>; sensitive: boolean } => {
  const patterns = options.redactPatterns ?? DEFAULT_REDACT_PATTERNS;
  const sensitiveColumns = options.sensitiveColumns ?? [];

  const out: Record<string, unknown> = {};
  let sensitive = false;

  for (const [field, v] of Object.entries(value)) {
    if (isRedacted(field, patterns, sensitiveColumns)) {
      sensitive = true;
      out[field] = REDACTED;
    } else {
      out[field] = v;
    }
  }

  return { value: out, sensitive };
};
