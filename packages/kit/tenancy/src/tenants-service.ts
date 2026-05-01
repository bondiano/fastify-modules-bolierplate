import type { Selectable } from 'kysely';

import {
  isUniqueViolation,
  type PageBasedPaginationOptions,
  type PaginatedPage,
  type Trx,
} from '@kit/db/runtime';

import {
  TenantNotFound,
  TenantSlugConflict,
  TenantSlugExhausted,
} from './errors.js';
import type { TenancyDB, TenantsTable } from './schema.js';
import { MAX_SLUG_LENGTH, slugify } from './slugify.js';
import type {
  CreateTenantData,
  UpdateTenantData,
} from './tenants-repository.js';

/** Upper bound on numeric-suffix attempts before we bail with `TenantSlugExhausted`. */
const MAX_SLUG_SUFFIX_ATTEMPTS = 100;

/**
 * Width reserved for the numeric suffix appended to a slug when collisions
 * happen (`-2` .. `-100`). We cap the base slug at
 * `MAX_SLUG_LENGTH - SUFFIX_BUDGET` so that even the worst-case suffix
 * keeps the final slug within the 63-char hostname limit.
 */
const SUFFIX_BUDGET = 4; // '-' + up to 3 digits
const MAX_BASE_SLUG_LENGTH = MAX_SLUG_LENGTH - SUFFIX_BUDGET;

export interface CreateTenantInput {
  readonly name: string;
  /**
   * Optional override for the auto-derived slug. When omitted, `slugify(name)`
   * + numeric-suffix collision resolution is used.
   */
  readonly slug?: string;
}

export interface RenameTenantInput {
  /** New display name. Leaves `slug` untouched unless `slug` is also provided. */
  readonly name?: string;
  /** New URL slug. Conflicts with another tenant throw `TenantSlugConflict`. */
  readonly slug?: string;
}

/**
 * Subset of `TenantsRepository` consumed by the service. Typed against
 * canonical `TenantsTable` shapes; the consumer's generic
 * `TenantsRepository<DB>` satisfies this via covariance in return
 * positions.
 */
export interface TenantsServiceRepoView {
  findById(id: string): Promise<Selectable<TenantsTable> | undefined>;
  findBySlugIncludingDeleted(
    slug: string,
  ): Promise<Selectable<TenantsTable> | undefined>;
  create(data: CreateTenantData): Promise<Selectable<TenantsTable>>;
  update(
    id: string,
    data: UpdateTenantData,
  ): Promise<Selectable<TenantsTable> | undefined>;
  softDelete(id: string): Promise<Selectable<TenantsTable> | undefined>;
  findPaginatedByPage(
    options?: PageBasedPaginationOptions,
  ): Promise<PaginatedPage<Selectable<TenantsTable>>>;
}

export interface TenantsServiceDeps<DB extends TenancyDB> {
  readonly tenantsRepository: TenantsServiceRepoView;
  /**
   * `@kit/db`'s `Trx<DB>` is both callable (`transaction(cb)`) and a
   * Kysely query builder (`transaction.updateTable(...)`). The service
   * uses the former to wrap `softDelete` in a single transaction and
   * the latter to cascade `deletedAt` onto child rows.
   */
  readonly transaction: Trx<DB>;
}

export interface TenantsService {
  create(input: CreateTenantInput): Promise<Selectable<TenantsTable>>;
  rename(
    id: string,
    input: RenameTenantInput,
  ): Promise<Selectable<TenantsTable>>;
  /**
   * **Admin-only.** Returns every tenant in the system without any
   * authorization filter -- callers must guard the route with a
   * system-admin ability before invoking this.
   */
  list(
    options?: PageBasedPaginationOptions,
  ): Promise<PaginatedPage<Selectable<TenantsTable>>>;
  /**
   * Soft-deletes the tenant **and** cascades `deletedAt` onto every
   * membership + invitation in that tenant within a single transaction.
   * Without the cascade, `ON DELETE CASCADE` on the FK would not fire
   * (no row is physically deleted) and ghost memberships would remain
   * accessible via `unscoped()` reads.
   */
  softDelete(id: string): Promise<Selectable<TenantsTable>>;
}

const cappedSlugify = (input: string): string =>
  slugify(input, { maxLength: MAX_BASE_SLUG_LENGTH });

export const createTenantsService = <DB extends TenancyDB>({
  tenantsRepository,
  transaction,
}: TenantsServiceDeps<DB>): TenantsService => {
  const tryCreate = async (
    name: string,
    slug: string,
  ): Promise<Selectable<TenantsTable> | null> => {
    try {
      return await tenantsRepository.create({ name, slug });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  };

  const createWithSlugRetry = async (
    name: string,
    baseSlug: string,
  ): Promise<Selectable<TenantsTable>> => {
    const initial =
      await tenantsRepository.findBySlugIncludingDeleted(baseSlug);
    if (!initial) {
      const created = await tryCreate(name, baseSlug);
      if (created) return created;
    }

    for (let suffix = 2; suffix <= MAX_SLUG_SUFFIX_ATTEMPTS; suffix++) {
      const candidate = `${baseSlug}-${suffix}`;
      const existing =
        await tenantsRepository.findBySlugIncludingDeleted(candidate);
      if (existing) continue;
      const created = await tryCreate(name, candidate);
      if (created) return created;
    }
    throw new TenantSlugExhausted(baseSlug);
  };

  return {
    create: async ({ name, slug }) => {
      const baseSlug = cappedSlugify(slug ?? name);
      return createWithSlugRetry(name, baseSlug);
    },

    rename: async (id, { name, slug }) => {
      const existing = await tenantsRepository.findById(id);
      if (!existing) throw new TenantNotFound(id);

      const patch: UpdateTenantData = {
        updatedAt: new Date().toISOString(),
      };
      if (name !== undefined) {
        (patch as { name?: string }).name = name;
      }

      if (slug !== undefined) {
        const desired = cappedSlugify(slug);
        const collision =
          await tenantsRepository.findBySlugIncludingDeleted(desired);
        if (collision && collision.id !== id) {
          throw new TenantSlugConflict(desired);
        }
        (patch as { slug?: string }).slug = desired;
      }

      const updated = await tenantsRepository.update(id, patch);
      if (!updated) throw new TenantNotFound(id);
      return updated;
    },

    list: async (options = {}) =>
      tenantsRepository.findPaginatedByPage(options),

    softDelete: async (id) =>
      transaction(async () => {
        const deleted = await tenantsRepository.softDelete(id);
        if (!deleted) throw new TenantNotFound(id);
        const now = new Date().toISOString();
        // Cascade deletedAt onto child rows. Direct UPDATEs (rather than
        // opening a tenant frame and calling scoped repos) keep this code
        // path side-effect-free w.r.t. AsyncLocalStorage.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = transaction as any;
        await raw
          .updateTable('memberships')
          .set({ deletedAt: now })
          .where(raw.dynamic.ref('tenantId'), '=', id)
          .where(raw.dynamic.ref('deletedAt'), 'is', null)
          .execute();
        await raw
          .updateTable('invitations')
          .set({ deletedAt: now })
          .where(raw.dynamic.ref('tenantId'), '=', id)
          .where(raw.dynamic.ref('deletedAt'), 'is', null)
          .execute();
        return deleted;
      }),
  };
};
