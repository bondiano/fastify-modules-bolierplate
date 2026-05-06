/**
 * Kysely table interfaces for the canonical mailer tables. Consumers
 * whose generated `DB` extends `MailerDB` (via interface merging in
 * `services/api/src/db/schema.ts`) get all the mailer repositories +
 * service typed end-to-end.
 *
 * Design notes:
 *
 * - `mail_deliveries` IS the outbox. Inserts happen synchronously after
 *   the originating tx commits; BullMQ carries `{ deliveryId }` only.
 *   `idempotency_key UNIQUE` plus `ON CONFLICT (idempotency_key) DO
 *   UPDATE SET updated_at = now() RETURNING id` makes the insert idempotent
 *   so the caller can retry blindly without duplicates.
 *
 * - `mail_events` is a webhook event ledger. Each provider sends a unique
 *   `event_id`; we store the raw payload (JSONB), ACK 200 fast, and
 *   process async via `mail.process-event`. UNIQUE on `(provider,
 *   event_id)` makes ingestion idempotent.
 *
 * - `mail_suppressions` is the do-not-send list. Hard bounces +
 *   complaints land here permanently (CAN-SPAM §5(a)(4) requires opt-out
 *   honored indefinitely). Soft bounces do NOT enter; the worker tracks
 *   consecutive soft-bounce counts elsewhere.
 *
 * Per-tenant `mail_from` columns are added to the existing `tenants`
 * table via a separate migration (`add_mail_from_to_tenants`) and surfaced
 * by `services/api`'s `TenantsTable` extension; we don't redeclare the
 * `tenants` shape here to avoid drift with `@kit/tenancy`.
 */
import type { ColumnType, Generated } from 'kysely';

export type MailDeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed';

export type MailSuppressionReason =
  | 'hard_bounce'
  | 'complaint'
  | 'unsubscribe'
  | 'manual';

export interface MailDeliveriesTable {
  id: Generated<string>;
  /** Caller-provided business idempotency key (e.g.
   * `password-reset:${tokenId}`). UNIQUE; DB rejects duplicate inserts
   * via ON CONFLICT. */
  idempotencyKey: string;
  /** NULL OK -- pre-tenant flows (signup / password-reset request) emit
   * deliveries before any tenant exists for the recipient. */
  tenantId: string | null;
  userId: string | null;
  template: string;
  templateVersion: Generated<string>;
  locale: Generated<string>;
  toAddress: string;
  fromAddress: string;
  replyTo: string | null;
  subject: string;
  /** Template inputs (NOT rendered HTML -- HTML is reproducible from
   * `(template, templateVersion, locale, payload)` and bloats this table
   * fast otherwise). */
  payload: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | null | undefined,
    Record<string, unknown> | null
  >;
  provider: string | null;
  providerMessageId: string | null;
  status: ColumnType<
    MailDeliveryStatus,
    MailDeliveryStatus,
    MailDeliveryStatus
  >;
  attempts: Generated<number>;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  /** Mirrors `req.id` from the originating request; ties mail_deliveries
   * rows to log lines + audit_log rows. */
  correlationId: string | null;
  tags: ColumnType<
    readonly string[],
    readonly string[] | undefined,
    readonly string[]
  >;
  /** NULL = send immediately. Future-dated rows wait for the sweep job. */
  scheduledFor: ColumnType<
    Date | null,
    string | null | undefined,
    string | null
  >;
  queuedAt: ColumnType<Date, string | undefined, string | undefined>;
  sentAt: ColumnType<Date | null, string | null | undefined, string | null>;
  bouncedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  complainedAt: ColumnType<
    Date | null,
    string | null | undefined,
    string | null
  >;
  /** Column ships in v1; webhook routing of open events deferred to Phase 3. */
  openedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  /** Column ships in v1; webhook routing of click events deferred to Phase 3. */
  clickedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  failedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface MailEventsTable {
  id: Generated<string>;
  provider: string;
  /** Provider-supplied unique event id. UNIQUE per provider so duplicate
   * webhook deliveries are absorbed by ON CONFLICT. */
  eventId: string;
  type: string;
  /** Best-effort link back to a delivery row -- nullable because some
   * provider events arrive before the matching delivery row is in our
   * DB (latency / out-of-order webhooks). */
  providerMessageId: string | null;
  raw: ColumnType<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
  occurredAt: ColumnType<Date, string, string>;
  receivedAt: ColumnType<Date, string | undefined, string | undefined>;
  processedAt: ColumnType<
    Date | null,
    string | null | undefined,
    string | null
  >;
}

export interface MailSuppressionsTable {
  id: Generated<string>;
  /** NULL = global suppression (e.g. user clicked Gmail's "Report spam"
   * before any tenant resolution was possible). Most rows have a tenant. */
  tenantId: string | null;
  /** Lower-cased email; UNIQUE per `(tenant_id, email_lower)`. */
  emailLower: string;
  reason: MailSuppressionReason;
  /** Free-form source string: `'webhook:resend'`, `'manual:admin@...'`,
   * `'import:csv@2026-05-01'`. Useful for forensic explanation when
   * deliveries are dropped. */
  source: string;
  /** NULL = permanent (hard bounces / complaints, per CAN-SPAM). Set
   * an expiry only for `manual` rows that should auto-clear. */
  expiresAt: ColumnType<Date | null, string | null | undefined, string | null>;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

/**
 * Minimum DB shape required by the mailer repositories. A consumer's
 * generated `DB` type must extend this so `Trx<DB>` references the
 * correct column metadata.
 */
export interface MailerDB {
  mail_deliveries: MailDeliveriesTable;
  mail_events: MailEventsTable;
  mail_suppressions: MailSuppressionsTable;
}
