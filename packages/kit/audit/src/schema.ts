import type { ColumnType, Generated } from 'kysely';

import type { TenancyDB } from '@kit/tenancy';

/**
 * Kysely-style table interface for the canonical audit_log table. A
 * consumer's generated `DB` type extends `AuditDB` (which itself extends
 * `TenancyDB`) so the FK from `audit_log.tenant_id -> tenants.id` is
 * type-safe. See `migrations/20260503000001_create_audit_log.ts` for the
 * backing DDL.
 */
export interface AuditLogTable {
  id: Generated<string>;
  /** NULL for pre-tenant flows (signup, password reset) and system actions. */
  tenantId: string | null;
  /** NULL when the actor is a background job, CLI, or unauthenticated request. */
  actorId: string | null;
  subjectType: string;
  subjectId: string;
  /** Free-form action label (e.g. `'create'`, `'update'`, `'delete'`, `'auth.login'`). */
  action: string;
  /** Per-field `{ before, after }` diff. NULL when the action has no diff
   * (read-only events, sign-in, etc.). */
  diff: ColumnType<
    Record<string, { before: unknown; after: unknown }> | null,
    Record<string, { before: unknown; after: unknown }> | null | undefined,
    Record<string, { before: unknown; after: unknown }> | null
  >;
  /** Caller-supplied metadata + automatic enrichment ({ statusCode, correlationId }). */
  metadata: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | null | undefined,
    Record<string, unknown> | null
  >;
  ip: string | null;
  userAgent: string | null;
  /** Mirrors `req.id` (Fastify `genReqId`); ties audit rows to log lines. */
  correlationId: string | null;
  /** True when at least one diff field was redacted by the redactor. */
  sensitive: Generated<boolean>;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

/**
 * Minimum DB shape required by the audit repository. A consumer's generated
 * `DB` type must extend this so `Trx<DB>` references the correct column
 * metadata. Extends `TenancyDB` because the FK to `tenants.id` is part of
 * the contract.
 */
export interface AuditDB extends TenancyDB {
  audit_log: AuditLogTable;
}
