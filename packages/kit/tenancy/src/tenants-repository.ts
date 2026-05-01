import type { Insertable, Selectable, Updateable } from 'kysely';

import {
  createSoftDeleteRepository,
  type SoftDeleteRepository,
  type Trx,
} from '@kit/db/runtime';

import type { TenancyDB } from './schema.js';

/**
 * Insertable subset accepted by `tenantsRepository.create`. Narrower than
 * `Insertable<DB['tenants']>` so callers cannot accidentally provide
 * `id` / timestamps / `deletedAt` from request payloads.
 */
export interface CreateTenantData {
  readonly name: string;
  readonly slug: string;
}

/** Update subset accepted by `tenantsRepository.update`. */
export interface UpdateTenantData {
  readonly name?: string;
  readonly slug?: string;
  readonly updatedAt?: string;
}

/**
 * Repository for the `tenants` table. Intentionally **not** tenant-scoped:
 * this table governs tenants themselves, so filtering by the active frame
 * would break every read. Callers are free to operate on any tenant row
 * -- authorization is the caller's responsibility (see `P2.tenancy.9`).
 */
export interface TenantsRepository<DB extends TenancyDB> extends Omit<
  SoftDeleteRepository<DB, 'tenants'>,
  'create' | 'update'
> {
  create(data: CreateTenantData): Promise<Selectable<DB['tenants']>>;
  update(
    id: string,
    data: UpdateTenantData,
  ): Promise<Selectable<DB['tenants']> | undefined>;
  /** Lookup a live tenant by its URL slug. */
  findBySlug(slug: string): Promise<Selectable<DB['tenants']> | undefined>;
  /** Lookup by slug without filtering soft-deleted rows. */
  findBySlugIncludingDeleted(
    slug: string,
  ): Promise<Selectable<DB['tenants']> | undefined>;
}

export interface TenantsRepositoryDeps<DB extends TenancyDB> {
  readonly transaction: Trx<DB>;
}

export const createTenantsRepository = <DB extends TenancyDB>({
  transaction,
}: TenantsRepositoryDeps<DB>): TenantsRepository<DB> => {
  const base = createSoftDeleteRepository<DB, 'tenants'>(
    transaction,
    'tenants',
  );
  // Kysely's deep generic types defeat a polymorphic bespoke helper -- same
  // escape hatch the base repos use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;

  return {
    ...base,

    create: async (data) =>
      // The narrowed `CreateTenantData` is structurally a subset of
      // `Insertable<DB['tenants']>` for any `DB extends TenancyDB`, but
      // TS cannot prove this against an arbitrary `DB`. Cast through
      // `unknown` once at the boundary.
      await base.create(data as unknown as Insertable<DB['tenants']>),

    update: async (id, data) =>
      await base.update(id, data as unknown as Updateable<DB['tenants']>),

    findBySlug: async (slug) =>
      await trx
        .selectFrom('tenants')
        .selectAll()
        .where(trx.dynamic.ref('slug'), '=', slug)
        .where(trx.dynamic.ref('deletedAt'), 'is', null)
        .executeTakeFirst(),

    findBySlugIncludingDeleted: async (slug) =>
      await trx
        .selectFrom('tenants')
        .selectAll()
        .where(trx.dynamic.ref('slug'), '=', slug)
        .executeTakeFirst(),
  };
};
