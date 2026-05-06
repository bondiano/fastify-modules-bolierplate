/**
 * Suppression list. Hard bounces and complaints land here permanently;
 * unsubscribes when the consumer wires List-Unsubscribe (Phase 3);
 * `manual` rows for admin-curated blocks.
 *
 * Pre-send lookup goes through a Redis cache (`SISMEMBER` per-tenant set,
 * 1h TTL) populated lazily on miss. The cache is invalidated on every
 * write so stale 'is suppressed' answers can't outlive a manual unblock.
 */
import type { Insertable, Selectable } from 'kysely';

import type { BaseRepository, Trx } from '@kit/db/runtime';
import {
  createTenantScopedRepository,
  type TenantContext,
  type TenantScopedRepository,
} from '@kit/tenancy';

import type {
  MailSuppressionsTable,
  MailSuppressionReason,
  MailerDB,
} from './schema.js';

export type MailSuppressionInsert = Insertable<MailSuppressionsTable>;
export type MailSuppressionRow = Selectable<MailSuppressionsTable>;

type ReadSurface<DB extends MailerDB> = Pick<
  TenantScopedRepository<DB, 'mail_suppressions'>,
  | 'table'
  | 'findById'
  | 'findByIdOrThrow'
  | 'findAll'
  | 'findPaginated'
  | 'findPaginatedByPage'
  | 'count'
>;

/**
 * Tiny Redis-shaped interface so the repo can stay backend-agnostic
 * (in tests we pass `ioredis-mock`; in production an `ioredis` client).
 * We need just `sismember`, `sadd`, `srem`, `expire`.
 */
export interface SuppressionCache {
  sismember(key: string, member: string): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<number>;
  del(key: string): Promise<number>;
}

const CACHE_TTL_SECONDS = 3600;

const cacheKey = (tenantId: string | null): string =>
  tenantId === null
    ? 'mail:suppressions:_global'
    : `mail:suppressions:${tenantId}`;

export interface AddSuppressionInput {
  readonly tenantId: string | null;
  readonly email: string;
  readonly reason: MailSuppressionReason;
  readonly source: string;
  readonly expiresAt?: Date;
}

export interface MailSuppressionsRepository<
  DB extends MailerDB,
> extends ReadSurface<DB> {
  /** Pre-send lookup. Checks tenant-scoped cache first, falls back to
   * DB on miss and warms the cache. */
  isSuppressed(email: string, tenantId?: string | null): Promise<boolean>;

  /** Idempotent insert. ON CONFLICT updates `reason` / `source` /
   * `expires_at` so a hard-bounce row supersedes an earlier soft-bounce
   * `manual` entry. Pops the cache so the next `isSuppressed` reads
   * the fresh state. */
  add(input: AddSuppressionInput): Promise<MailSuppressionRow>;

  /** Remove a suppression. Used by admin "unblock" and by a TTL sweep
   * (Phase 3) for `manual` rows with `expires_at` in the past. */
  remove(input: { tenantId: string | null; email: string }): Promise<boolean>;

  /** Drops the cache entry for a tenant -- callers can use this after
   * bulk imports or manual edits to force a re-read. */
  invalidateCache(tenantId: string | null): Promise<void>;

  unscoped(): BaseRepository<DB, 'mail_suppressions'>;
}

export interface MailSuppressionsRepositoryDeps<DB extends MailerDB> {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
  readonly cache: SuppressionCache;
}

export const createMailSuppressionsRepository = <DB extends MailerDB>({
  transaction,
  tenantContext,
  cache,
}: MailSuppressionsRepositoryDeps<DB>): MailSuppressionsRepository<DB> => {
  const scoped = createTenantScopedRepository<DB, 'mail_suppressions'>({
    transaction,
    tenantContext,
    tableName: 'mail_suppressions',
    tenantColumn: 'tenant_id',
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;

  const resolveTenantId = (override?: string | null): string | null => {
    if (override !== undefined) return override;
    const value = tenantContext.tryCurrentTenant();
    return value?.tenantId ?? null;
  };

  const isSuppressed = async (
    email: string,
    tenantOverride?: string | null,
  ): Promise<boolean> => {
    const tenantId = resolveTenantId(tenantOverride);
    const lower = email.toLowerCase();
    const key = cacheKey(tenantId);

    const cached = await cache.sismember(key, lower);
    if (cached === 1) return true;

    // Cache miss is two-shaped: either the email genuinely isn't
    // suppressed, or the cache hasn't been warmed yet for this tenant.
    // Read DB; populate cache on hit. We don't try to populate the full
    // tenant set here -- that risks O(suppressions) reads per
    // process-startup. Instead the cache fills lazily as send attempts
    // come in.
    const nowIso = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = trx
      .selectFrom('mail_suppressions')
      .select('id')
      .where('email_lower', '=', lower)
      // Permanent (`expires_at IS NULL`) OR not-yet-expired
      // (`expires_at > now()`).
      .where(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (eb: any) =>
          eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', nowIso)]),
      );

    query =
      tenantId === null
        ? query.where('tenant_id', 'is', null)
        : query.where(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (eb: any) =>
              eb.or([
                eb('tenant_id', '=', tenantId),
                eb('tenant_id', 'is', null),
              ]),
          );

    const row = await query.executeTakeFirst();
    if (row) {
      await cache.sadd(key, lower);
      await cache.expire(key, CACHE_TTL_SECONDS);
      return true;
    }
    return false;
  };

  const add = async (
    input: AddSuppressionInput,
  ): Promise<MailSuppressionRow> => {
    const lower = input.email.toLowerCase();
    const values = {
      tenant_id: input.tenantId,
      email_lower: lower,
      reason: input.reason,
      source: input.source,
      expires_at: input.expiresAt?.toISOString() ?? null,
    };
    const conflictTarget =
      input.tenantId === null
        ? 'uq_mail_suppressions_global_email'
        : 'uq_mail_suppressions_tenant_email';
    const row = await trx
      .insertInto('mail_suppressions')
      .values(values)
      .onConflict(
        (oc: {
          constraint: (name: string) => {
            doUpdateSet: (set: Record<string, unknown>) => unknown;
          };
        }) =>
          oc.constraint(conflictTarget).doUpdateSet({
            reason: input.reason,
            source: input.source,
            expires_at: input.expiresAt?.toISOString() ?? null,
          }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    await cache.sadd(cacheKey(input.tenantId), lower);
    await cache.expire(cacheKey(input.tenantId), CACHE_TTL_SECONDS);
    return row;
  };

  const remove = async ({
    tenantId,
    email,
  }: {
    tenantId: string | null;
    email: string;
  }): Promise<boolean> => {
    const lower = email.toLowerCase();
    let query = trx
      .deleteFrom('mail_suppressions')
      .where('email_lower', '=', lower);
    query =
      tenantId === null
        ? query.where('tenant_id', 'is', null)
        : query.where('tenant_id', '=', tenantId);
    const removed = await query.returning('id').execute();
    if (removed.length > 0) await cache.srem(cacheKey(tenantId), lower);
    return removed.length > 0;
  };

  const invalidateCache = async (tenantId: string | null): Promise<void> => {
    await cache.del(cacheKey(tenantId));
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

    isSuppressed,
    add,
    remove,
    invalidateCache,
  };
};
