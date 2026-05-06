/**
 * Repository for the `mail_deliveries` outbox table.
 *
 * Two surfaces:
 * - **Tenant-scoped reads** (admin pagination / detail view). Composes
 *   `@kit/tenancy`'s `createTenantScopedRepository`.
 * - **System-level writes** (enqueue, status transitions, sweep). The
 *   outbox callbacks fire after the originating tx commits but BEFORE
 *   any tenant frame is opened (or AT enqueue time when the tenant is
 *   known) -- so the writes need to work without `withTenant`. We use
 *   the raw `Trx<DB>` for these and stamp `tenant_id` explicitly on
 *   each insert.
 *
 * Idempotency is enforced at the DB layer: `enqueue(...)` does
 * `INSERT ... ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
 * RETURNING *` -- duplicate enqueues from retries return the existing row
 * without producing a duplicate send.
 */
import type { Insertable, Selectable } from 'kysely';

import type { BaseRepository, Trx } from '@kit/db/runtime';
import {
  createTenantScopedRepository,
  type TenantContext,
  type TenantScopedRepository,
} from '@kit/tenancy';

import type {
  MailDeliveriesTable,
  MailDeliveryStatus,
  MailerDB,
} from './schema.js';

export type MailDeliveryInsert = Insertable<MailDeliveriesTable>;
export type MailDeliveryRow = Selectable<MailDeliveriesTable>;

type ReadSurface<DB extends MailerDB> = Pick<
  TenantScopedRepository<DB, 'mail_deliveries'>,
  | 'table'
  | 'findById'
  | 'findByIdOrThrow'
  | 'findAll'
  | 'findPaginated'
  | 'findPaginatedByPage'
  | 'count'
>;

/** Inputs accepted by `findFilteredAdmin`. Mirrors the `@kit/admin`
 * `FilterSpec` shape: each declared filter lands here as a string keyed
 * by spec name; date-range filters surface as `<name>From` / `<name>To`. */
export interface MailDeliveryFilterAdminOptions {
  readonly page: number;
  readonly limit: number;
  readonly orderBy?: string;
  readonly order?: 'asc' | 'desc';
  readonly search?: string;
  readonly filters: Readonly<Record<string, string>>;
}

export interface MailDeliveryEnqueueInput {
  readonly idempotencyKey: string;
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly template: string;
  readonly templateVersion?: string;
  readonly locale?: string;
  readonly toAddress: string;
  readonly fromAddress: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly payload: Record<string, unknown>;
  readonly correlationId?: string;
  readonly tags?: readonly string[];
  readonly scheduledFor?: Date;
}

export interface MailDeliveriesRepository<
  DB extends MailerDB,
> extends ReadSurface<DB> {
  /** Insert a new delivery row in `'queued'` state, dedupe on
   * `idempotency_key`. Returns the row (existing or newly inserted).
   * Frame-less; safe to call from outside `withTenant`. */
  enqueue(input: MailDeliveryEnqueueInput): Promise<MailDeliveryRow>;

  /** System-level read by id (skips the tenant filter). Used by the
   * `mail.send` worker which receives only `{ deliveryId }` in job data
   * and may need to read across tenant boundaries during sweep. */
  findByIdGlobally(id: string): Promise<MailDeliveryRow | null>;

  /** Used by `enqueue` callers that want to assert idempotency before
   * the insert (rare; the ON CONFLICT path handles it transparently
   * for the common case). */
  findByIdempotencyKey(key: string): Promise<MailDeliveryRow | null>;

  /** Sweep selector: rows stuck at `'queued'` whose `queued_at` is
   * older than `now - olderThanMs`. Capped by `limit`. Used by the
   * `mail.sweep` cron to re-enqueue rows that fell out of BullMQ
   * (e.g. process died between commit and `queue.add()`). */
  findStaleQueued(opts: {
    olderThanMs: number;
    limit: number;
  }): Promise<readonly MailDeliveryRow[]>;

  /** Mark a delivery as currently dispatching. Bumps `attempts` and
   * stamps `provider` so admin reads show in-flight state. */
  markSending(id: string, provider: string): Promise<void>;

  markSent(id: string, providerMessageId: string): Promise<void>;
  markBounced(id: string, reason?: string): Promise<void>;
  markComplained(id: string, reason?: string): Promise<void>;
  markSuppressed(id: string): Promise<void>;
  markFailed(id: string, code: string, message: string): Promise<void>;
  /** Records a retryable attempt's error metadata without changing
   * status (BullMQ keeps the row in 'queued' between retries). */
  recordAttempt(id: string, code: string, message: string): Promise<void>;

  /** Webhook event update: hydrate `opened_at` / `clicked_at` /
   * `bounced_at` etc. when a `mail_events` row references this delivery. */
  applyEvent(input: {
    providerMessageId: string;
    type:
      | 'delivered'
      | 'bounced.hard'
      | 'bounced.soft'
      | 'complained'
      | 'opened'
      | 'clicked';
    occurredAt: Date;
    reason?: string;
  }): Promise<MailDeliveryRow | null>;

  findFilteredAdmin(opts: MailDeliveryFilterAdminOptions): Promise<{
    items: readonly MailDeliveryRow[];
    total: number;
  }>;

  distinctValues(column: string, limit?: number): Promise<readonly string[]>;

  unscoped(): BaseRepository<DB, 'mail_deliveries'>;
}

export interface MailDeliveriesRepositoryDeps<DB extends MailerDB> {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
}

const PROVIDER_MESSAGE_FIELDS = new Set([
  'delivered',
  'bounced.hard',
  'bounced.soft',
  'complained',
  'opened',
  'clicked',
]);

const eventToStatus = (type: string): MailDeliveryStatus | null => {
  switch (type) {
    case 'delivered': {
      return 'sent';
    }
    case 'bounced.hard':
    case 'bounced.soft': {
      return 'bounced';
    }
    case 'complained': {
      return 'complained';
    }
    default: {
      return null;
    }
  }
};

const eventToTimestampColumn = (
  type: string,
):
  | 'sent_at'
  | 'bounced_at'
  | 'complained_at'
  | 'opened_at'
  | 'clicked_at'
  | null => {
  switch (type) {
    case 'delivered': {
      return 'sent_at';
    }
    case 'bounced.hard':
    case 'bounced.soft': {
      return 'bounced_at';
    }
    case 'complained': {
      return 'complained_at';
    }
    case 'opened': {
      return 'opened_at';
    }
    case 'clicked': {
      return 'clicked_at';
    }
    default: {
      return null;
    }
  }
};

export const createMailDeliveriesRepository = <DB extends MailerDB>({
  transaction,
  tenantContext,
}: MailDeliveriesRepositoryDeps<DB>): MailDeliveriesRepository<DB> => {
  const scoped = createTenantScopedRepository<DB, 'mail_deliveries'>({
    transaction,
    tenantContext,
    tableName: 'mail_deliveries',
    tenantColumn: 'tenant_id',
  });

  // Kysely's polymorphic types over the consumer's DB make typed raw
  // SQL builders awkward; we treat the trx as untyped at the boundary
  // and rely on the public method signatures to keep callers honest --
  // same pattern as `@kit/audit/src/audit-log-repository.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;

  const enqueue = async (
    input: MailDeliveryEnqueueInput,
  ): Promise<MailDeliveryRow> => {
    const values = {
      idempotency_key: input.idempotencyKey,
      tenant_id: input.tenantId,
      user_id: input.userId,
      template: input.template,
      template_version: input.templateVersion ?? 'v1',
      locale: input.locale ?? 'en',
      to_address: input.toAddress,
      from_address: input.fromAddress,
      reply_to: input.replyTo ?? null,
      subject: input.subject,
      payload: input.payload,
      correlation_id: input.correlationId ?? null,
      tags: input.tags ?? [],
      scheduled_for: input.scheduledFor?.toISOString() ?? null,
      status: 'queued' as const,
    };
    return await trx
      .insertInto('mail_deliveries')
      .values(values)
      .onConflict(
        (oc: {
          column: (col: string) => {
            doUpdateSet: (set: Record<string, unknown>) => unknown;
          };
        }) =>
          oc
            .column('idempotency_key')
            .doUpdateSet({ updated_at: trx.fn('now') }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  };

  const findByIdGlobally = async (
    id: string,
  ): Promise<MailDeliveryRow | null> =>
    (await trx
      .selectFrom('mail_deliveries')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()) ?? null;

  const findByIdempotencyKey = async (
    key: string,
  ): Promise<MailDeliveryRow | null> =>
    (await trx
      .selectFrom('mail_deliveries')
      .selectAll()
      .where('idempotency_key', '=', key)
      .executeTakeFirst()) ?? null;

  const findStaleQueued = async ({
    olderThanMs,
    limit,
  }: {
    olderThanMs: number;
    limit: number;
  }): Promise<readonly MailDeliveryRow[]> => {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    return await trx
      .selectFrom('mail_deliveries')
      .selectAll()
      .where('status', '=', 'queued')
      .where('queued_at', '<', cutoff)
      .orderBy('queued_at', 'asc')
      .limit(limit)
      .execute();
  };

  const updateRow = async (
    id: string,
    set: Record<string, unknown>,
  ): Promise<void> => {
    await trx
      .updateTable('mail_deliveries')
      .set({ ...set, updated_at: new Date().toISOString() })
      .where('id', '=', id)
      .execute();
  };

  const markSending = async (id: string, provider: string): Promise<void> => {
    await trx
      .updateTable('mail_deliveries')
      .set({
        status: 'sending',
        provider,
        attempts: trx.eb('attempts', '+', 1),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', id)
      .execute();
  };

  const markSent = async (
    id: string,
    providerMessageId: string,
  ): Promise<void> => {
    const now = new Date().toISOString();
    await updateRow(id, {
      status: 'sent',
      provider_message_id: providerMessageId,
      sent_at: now,
      last_error_code: null,
      last_error_message: null,
    });
  };

  const markBounced = async (id: string, reason?: string): Promise<void> => {
    const now = new Date().toISOString();
    await updateRow(id, {
      status: 'bounced',
      bounced_at: now,
      last_error_code: 'BOUNCED',
      last_error_message: reason ?? null,
    });
  };

  const markComplained = async (id: string, reason?: string): Promise<void> => {
    const now = new Date().toISOString();
    await updateRow(id, {
      status: 'complained',
      complained_at: now,
      last_error_code: 'COMPLAINED',
      last_error_message: reason ?? null,
    });
  };

  const markSuppressed = async (id: string): Promise<void> => {
    await updateRow(id, {
      status: 'suppressed',
      last_error_code: 'SUPPRESSED',
      last_error_message: 'Recipient on suppression list',
    });
  };

  const markFailed = async (
    id: string,
    code: string,
    message: string,
  ): Promise<void> => {
    const now = new Date().toISOString();
    await updateRow(id, {
      status: 'failed',
      failed_at: now,
      last_error_code: code,
      last_error_message: message,
    });
  };

  const recordAttempt = async (
    id: string,
    code: string,
    message: string,
  ): Promise<void> => {
    await updateRow(id, {
      last_error_code: code,
      last_error_message: message,
    });
  };

  const applyEvent: MailDeliveriesRepository<DB>['applyEvent'] = async (
    input,
  ) => {
    if (!PROVIDER_MESSAGE_FIELDS.has(input.type)) return null;
    const status = eventToStatus(input.type);
    const timestampColumn = eventToTimestampColumn(input.type);
    const set: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (timestampColumn) set[timestampColumn] = input.occurredAt.toISOString();
    if (status) set.status = status;
    if (status === 'bounced' || status === 'complained') {
      set.last_error_code = status === 'bounced' ? 'BOUNCED' : 'COMPLAINED';
      set.last_error_message = input.reason ?? null;
    }
    const result = await trx
      .updateTable('mail_deliveries')
      .set(set)
      .where('provider_message_id', '=', input.providerMessageId)
      .returningAll()
      .executeTakeFirst();
    return result ?? null;
  };

  const findFilteredAdmin: MailDeliveriesRepository<DB>['findFilteredAdmin'] =
    async (opts) => {
      const tenantId = tenantContext.currentTenant().tenantId;
      const offset = (opts.page - 1) * opts.limit;
      const filters = opts.filters;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyWhere = (q: any) => {
        let next = q.where(trx.dynamic.ref('tenant_id'), '=', tenantId);
        if (filters['status']) {
          next = next.where(trx.dynamic.ref('status'), '=', filters['status']);
        }
        if (filters['template']) {
          next = next.where(
            trx.dynamic.ref('template'),
            '=',
            filters['template'],
          );
        }
        if (filters['toAddress']) {
          next = next.where(
            trx.dynamic.ref('to_address'),
            'ilike',
            `%${filters['toAddress']}%`,
          );
        }
        if (filters['queuedAtFrom']) {
          next = next.where(
            trx.dynamic.ref('queued_at'),
            '>=',
            new Date(filters['queuedAtFrom']),
          );
        }
        if (filters['queuedAtTo']) {
          const to = new Date(filters['queuedAtTo']);
          to.setUTCDate(to.getUTCDate() + 1);
          next = next.where(trx.dynamic.ref('queued_at'), '<', to);
        }
        if (opts.search && opts.search.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          next = next.where((eb: any) =>
            eb.or([
              eb(trx.dynamic.ref('to_address'), 'ilike', `%${opts.search}%`),
              eb(trx.dynamic.ref('subject'), 'ilike', `%${opts.search}%`),
            ]),
          );
        }
        return next;
      };

      const orderBy = opts.orderBy ?? 'queued_at';
      const order = opts.order ?? 'desc';

      const [data, countRow] = await Promise.all([
        applyWhere(trx.selectFrom('mail_deliveries').selectAll())
          .orderBy(trx.dynamic.ref(orderBy), order)
          .limit(opts.limit)
          .offset(offset)
          .execute(),
        applyWhere(trx.selectFrom('mail_deliveries'))
          .select(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (r: any) => r.fn.count(trx.dynamic.ref('id')).as('count'),
          )
          .executeTakeFirstOrThrow(),
      ]);

      return {
        items: data,
        total: Number((countRow as { count: number | string }).count),
      };
    };

  const distinctValues: MailDeliveriesRepository<DB>['distinctValues'] = async (
    column,
    limit = 50,
  ) => {
    const tenantId = tenantContext.currentTenant().tenantId;
    const rows = await trx
      .selectFrom('mail_deliveries')
      .select(trx.dynamic.ref(column).as('value'))
      .where(trx.dynamic.ref('tenant_id'), '=', tenantId)
      .where(trx.dynamic.ref(column), 'is not', null)
      .distinct()
      .orderBy(trx.dynamic.ref(column), 'asc')
      .limit(limit)
      .execute();
    return rows
      .map((r: { value: unknown }) =>
        r.value === null || r.value === undefined ? '' : String(r.value),
      )
      .filter((v: string) => v.length > 0);
  };

  return {
    table: scoped.table,
    findById: scoped.findById,
    findByIdOrThrow: scoped.findByIdOrThrow,
    findAll: scoped.findAll,
    findPaginated: scoped.findPaginated,
    findPaginatedByPage: scoped.findPaginatedByPage,
    count: scoped.count,
    unscoped: () => scoped.unscoped(),

    enqueue,
    findByIdGlobally,
    findByIdempotencyKey,
    findStaleQueued,
    markSending,
    markSent,
    markBounced,
    markComplained,
    markSuppressed,
    markFailed,
    recordAttempt,
    applyEvent,
    findFilteredAdmin,
    distinctValues,
  };
};
