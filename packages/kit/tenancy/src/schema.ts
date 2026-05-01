import type { ColumnType, Generated } from 'kysely';

/**
 * Kysely-style table interfaces for the canonical tenancy tables. Consumers
 * whose generated `DB` type extends `TenancyDB` can use `@kit/tenancy`'s
 * repository factories directly. See `migrations/20260424000001..3` for the
 * backing DDL.
 */

export interface TenantsTable {
  id: Generated<string>;
  slug: string;
  name: string;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
  deletedAt: ColumnType<Date | null, string | null | undefined, string | null>;
}

export interface MembershipsTable {
  id: Generated<string>;
  tenantId: string;
  userId: string;
  role: Generated<string>;
  invitedBy: string | null;
  joinedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  deletedAt: ColumnType<Date | null, string | null | undefined, string | null>;
}

export interface InvitationsTable {
  id: Generated<string>;
  tenantId: string;
  email: string;
  role: Generated<string>;
  tokenHash: string;
  invitedBy: string | null;
  expiresAt: ColumnType<Date, string, string>;
  acceptedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  deletedAt: ColumnType<Date | null, string | null | undefined, string | null>;
}

/**
 * Minimum DB shape required by the tenancy repositories. A consumer's
 * generated `DB` type must extend this so `Trx<DB>` references the correct
 * column metadata.
 */
export interface TenancyDB {
  tenants: TenantsTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
}
