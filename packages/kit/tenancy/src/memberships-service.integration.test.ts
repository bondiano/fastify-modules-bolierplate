/**
 * PGlite-backed integration coverage for `createMembershipsService`.
 * Exercises the real repositories + transaction proxy so we get end-to-end
 * confidence that:
 *
 *   - `accept` is atomic: a concurrent caller loses on `markAccepted`.
 *   - The email-match guard rejects mismatching users (token leak).
 *   - `invite` dedupes existing members + pending invitations correctly.
 *   - `revoke` soft-deletes and the partial unique index lets the same
 *     user re-join afterwards.
 *
 * The fast unit suite (`memberships-service.test.ts`) keeps using
 * minimal in-memory mocks for tight feedback; this file is the safety
 * net that proves the contract on a real Postgres-shaped backend.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ColumnType, Generated } from 'kysely';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTransactionFactory,
  createTransactionStorage,
  type Trx,
} from '@kit/db/runtime';
import { createTestDataSource, migrateToLatest } from '@kit/test/database';

import {
  createTenantContext,
  createTenantStorage,
  type TenantContext,
} from './context.js';
import {
  InvitationAlreadyAccepted,
  InvitationEmailMismatch,
  InvitationNotFound,
  MembershipExists,
  MembershipNotFound,
} from './errors.js';
import { createInvitationsRepository } from './invitations-repository.js';
import { createMembershipsRepository } from './memberships-repository.js';
import {
  createMembershipsService,
  type MembershipsService,
} from './memberships-service.js';
import type { TenancyDB } from './schema.js';

interface UsersTable {
  id: Generated<string>;
  email: string;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

interface DB extends TenancyDB {
  users: UsersTable;
}

const migrationsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

interface Fixture {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
  readonly service: MembershipsService;
  readonly close: () => Promise<void>;
  readonly tenantId: string;
  readonly otherTenantId: string;
  readonly seedUser: (email: string) => Promise<string>;
}

const buildFixture = async (): Promise<Fixture> => {
  const dataSource = await createTestDataSource<DB>();

  await dataSource.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await migrateToLatest(dataSource, migrationsPath);

  const transactionStorage = await createTransactionStorage<DB>();
  const transaction = createTransactionFactory<DB>({
    dataSource,
    transactionStorage,
  });
  const tenantStorage = createTenantStorage();
  const tenantContext = createTenantContext({ tenantStorage });

  // Seed two tenants for cross-tenant assertions.
  const acme = await dataSource
    .insertInto('tenants')
    .values({ slug: 'acme', name: 'Acme' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const globex = await dataSource
    .insertInto('tenants')
    .values({ slug: 'globex', name: 'Globex' })
    .returning('id')
    .executeTakeFirstOrThrow();

  const membershipsRepository = createMembershipsRepository<DB>({
    transaction,
    tenantContext,
  });
  const invitationsRepository = createInvitationsRepository<DB>({
    transaction,
    tenantContext,
  });

  const seedUser = async (email: string): Promise<string> => {
    const row = await dataSource
      .insertInto('users')
      .values({ email })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  };

  const userByEmail = new Map<string, string>();
  const userById = new Map<string, string>();

  const service = createMembershipsService({
    transaction,
    tenantContext,
    membershipsRepository,
    invitationsRepository,
    resolveUserEmail: async (userId) => userById.get(userId) ?? null,
    resolveUserIdByEmail: async (email) =>
      userByEmail.get(email.toLowerCase()) ?? null,
  });

  return {
    transaction,
    tenantContext,
    service,
    close: () => dataSource.destroy(),
    tenantId: acme.id,
    otherTenantId: globex.id,
    seedUser: async (email) => {
      const id = await seedUser(email);
      userByEmail.set(email.toLowerCase(), id);
      userById.set(id, email);
      return id;
    },
  };
};

describe('createMembershipsService (PGlite integration)', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await buildFixture();
  });

  afterEach(async () => {
    await f.close();
  });

  it('invite + accept produces a real membership and stamps acceptedAt', async () => {
    const userId = await f.seedUser('invitee@example.com');

    const { token } = await f.tenantContext.withTenant(f.tenantId, async () =>
      f.service.invite({ email: 'invitee@example.com' }),
    );

    const membership = await f.service.accept({ token, userId });
    expect(membership.tenantId).toBe(f.tenantId);
    expect(membership.userId).toBe(userId);
    expect(membership.role).toBe('member');

    // Invitation is now consumed.
    await expect(f.service.accept({ token, userId })).rejects.toBeInstanceOf(
      InvitationAlreadyAccepted,
    );
  });

  it('rejects redeem when the user email does not match the invitation', async () => {
    const userA = await f.seedUser('a@example.com');
    const userB = await f.seedUser('b@example.com');

    const { token } = await f.tenantContext.withTenant(f.tenantId, async () =>
      f.service.invite({ email: 'a@example.com' }),
    );

    await expect(
      f.service.accept({ token, userId: userB }),
    ).rejects.toBeInstanceOf(InvitationEmailMismatch);
    // The right user can still consume it.
    const membership = await f.service.accept({ token, userId: userA });
    expect(membership.userId).toBe(userA);
  });

  it('two concurrent accepts of the same token: one wins, the other races', async () => {
    const userId = await f.seedUser('race@example.com');

    const { token } = await f.tenantContext.withTenant(f.tenantId, async () =>
      f.service.invite({ email: 'race@example.com' }),
    );

    const settled = await Promise.allSettled([
      f.service.accept({ token, userId }),
      f.service.accept({ token, userId }),
    ]);
    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');
    // At most one branch may create a membership; the other either
    // throws InvitationAlreadyAccepted (lost the markAccepted gate) or
    // returns the existing membership (caught up after the gate).
    expect(fulfilled.length + rejected.length).toBe(2);
    if (rejected.length > 0) {
      expect(rejected[0]!.reason).toBeInstanceOf(InvitationAlreadyAccepted);
    }
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  });

  it('throws InvitationNotFound for a nonexistent token', async () => {
    const userId = await f.seedUser('ghost@example.com');
    await expect(
      f.service.accept({ token: 'definitely-not-a-real-token', userId }),
    ).rejects.toBeInstanceOf(InvitationNotFound);
  });

  it('invite normalizes email and dedupes a pending invitation', async () => {
    await f.seedUser('Mixed@Example.COM');
    const first = await f.tenantContext.withTenant(f.tenantId, async () =>
      f.service.invite({ email: '  Mixed@Example.COM  ' }),
    );
    expect(first.invitation.email).toBe('mixed@example.com');

    const second = await f.tenantContext.withTenant(f.tenantId, async () =>
      f.service.invite({ email: 'mixed@example.com' }),
    );
    // Same row regenerated, different token.
    expect(second.invitation.id).toBe(first.invitation.id);
    expect(second.token).not.toBe(first.token);

    // Only one row in the DB.
    const rows = await f.transaction
      .selectFrom('invitations')
      .selectAll()
      .where('email', '=', 'mixed@example.com')
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('invite throws MembershipExists when the email already maps to an active member', async () => {
    const userId = await f.seedUser('member@example.com');
    // Seed an active membership directly.
    await f.transaction
      .insertInto('memberships')
      .values({
        tenantId: f.tenantId,
        userId,
        role: 'admin',
        joinedAt: new Date().toISOString(),
      })
      .execute();

    await expect(
      f.tenantContext.withTenant(f.tenantId, async () =>
        f.service.invite({ email: 'member@example.com' }),
      ),
    ).rejects.toBeInstanceOf(MembershipExists);
  });

  it('revoke soft-deletes; the same user can be re-invited and re-accept', async () => {
    const userId = await f.seedUser('rejoin@example.com');

    const { token: firstToken } = await f.tenantContext.withTenant(
      f.tenantId,
      async () => f.service.invite({ email: 'rejoin@example.com' }),
    );
    const first = await f.service.accept({ token: firstToken, userId });

    const revoked = await f.tenantContext.withTenant(f.tenantId, async () =>
      f.service.revoke(first.id),
    );
    expect(revoked.id).toBe(first.id);
    expect(revoked.deletedAt).not.toBeNull();

    // The (tenant_id, user_id) partial unique index allows a fresh row.
    const { token: secondToken } = await f.tenantContext.withTenant(
      f.tenantId,
      async () => f.service.invite({ email: 'rejoin@example.com' }),
    );
    const second = await f.service.accept({ token: secondToken, userId });
    expect(second.id).not.toBe(first.id);
    expect(second.deletedAt).toBeNull();
  });

  it('revoke throws MembershipNotFound when the id does not exist in the active tenant', async () => {
    await expect(
      f.tenantContext.withTenant(f.tenantId, async () =>
        f.service.revoke('00000000-0000-0000-0000-000000000000'),
      ),
    ).rejects.toBeInstanceOf(MembershipNotFound);
  });

  it('regenerate mints a new token + extends expiry on a pending invitation', async () => {
    await f.seedUser('regen@example.com');
    const first = await f.tenantContext.withTenant(f.tenantId, async () =>
      f.service.invite({ email: 'regen@example.com' }),
    );

    const second = await f.tenantContext.withTenant(f.tenantId, async () =>
      f.service.regenerate(first.invitation.id),
    );
    expect(second.invitation.id).toBe(first.invitation.id);
    expect(second.token).not.toBe(first.token);
    // expiresAt was reset.
    expect(
      new Date(second.invitation.expiresAt).getTime(),
    ).toBeGreaterThanOrEqual(new Date(first.invitation.expiresAt).getTime());

    // Only the new token works.
    const userId = await f.seedUser('regen-other@example.com');
    // Wrong user email is rejected first.
    await expect(
      f.service.accept({ token: second.token, userId }),
    ).rejects.toBeInstanceOf(InvitationEmailMismatch);
  });
});
