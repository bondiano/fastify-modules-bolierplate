/**
 * Fast unit coverage for `createMembershipsService` focused on the
 * **event-handler** surface (`onInvitationCreated`) and a handful of
 * tightly scoped error paths -- things that don't need a real DB to
 * verify and that benefit from sub-millisecond feedback during
 * iteration.
 *
 * The full behavioural matrix (invite/accept/revoke/regenerate against
 * real repositories, race conditions, partial-unique-index semantics)
 * lives in `memberships-service.integration.test.ts` -- PGlite-backed,
 * exercises the actual SQL, and is the safety net we trust over these
 * mocks.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createTenantContext,
  createTenantStorage,
  type TenantContext,
} from './context.js';
import {
  createMembershipsService,
  type InvitationCreatedHandler,
  type InvitationsServiceRepoView,
  type MembershipsServiceRepoView,
  type TransactionRunner,
} from './memberships-service.js';

const sha256 = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

interface BuildFixtureOptions {
  readonly onInvitationCreated?: InvitationCreatedHandler;
}

// Pass-through transaction: this suite does not assert on the
// open/close lifecycle, so we just invoke the callback. The
// integration suite covers actual transactional semantics.
const passThroughTransaction: TransactionRunner = async (cb) => cb();

const buildFixture = (options: BuildFixtureOptions = {}) => {
  const tenantStorage = createTenantStorage();
  const tenantContext: TenantContext = createTenantContext({ tenantStorage });

  const invitationStore = new Map<string, Record<string, unknown>>();
  const tokenIndex = new Map<string, string>();
  let nextInvitationId = 1;

  const invitationsRepository: InvitationsServiceRepoView = {
    findById: vi.fn(async (id: string) => {
      const row = invitationStore.get(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return row as any;
    }),
    findByTokenHash: vi.fn(async (hash: string) => {
      const id = tokenIndex.get(hash);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return id ? (invitationStore.get(id) as any) : undefined;
    }),
    findPendingByEmail: vi.fn(async () => {}),
    markAccepted: vi.fn(async () => {}),
    create: vi.fn(async (data: Record<string, unknown>) => {
      const id = `inv-${nextInvitationId++}`;
      const persisted = {
        id,
        tenantId: tenantContext.currentTenant().tenantId,
        ...data,
        createdAt: new Date().toISOString(),
      };
      invitationStore.set(id, persisted);
      tokenIndex.set(persisted['tokenHash'] as string, id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return persisted as any;
    }),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => {
      const row = invitationStore.get(id);
      if (!row) return;
      const oldHash = row['tokenHash'] as string;
      const updated = { ...row, ...data };
      invitationStore.set(id, updated);
      const newHash = updated['tokenHash'] as string;
      if (newHash && newHash !== oldHash) {
        tokenIndex.delete(oldHash);
        tokenIndex.set(newHash, id);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return updated as any;
    }),
  };

  const membershipsRepository: MembershipsServiceRepoView = {
    findByUserIdInCurrentTenant: vi.fn(async () => {}),
    create: vi.fn(),
    softDelete: vi.fn(),
  };

  const service = createMembershipsService({
    transaction: passThroughTransaction,
    tenantContext,
    membershipsRepository,
    invitationsRepository,
    resolveUserEmail: async () => null,
    ...(options.onInvitationCreated
      ? { onInvitationCreated: options.onInvitationCreated }
      : {}),
  });

  return { service, tenantContext, invitationStore };
};

describe('createMembershipsService -- invite event handler', () => {
  it('emits an InvitationCreated event carrying the raw token exactly once', async () => {
    const handler = vi.fn();
    const f = buildFixture({ onInvitationCreated: handler });

    const result = await f.tenantContext.withTenant('acme', async () =>
      f.service.invite({
        email: 'invitee@example.com',
        role: 'admin',
        invitedBy: 'u-1',
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0]!;
    expect(event.invitationId).toBe(result.invitation.id);
    expect(event.tenantId).toBe('acme');
    expect(event.email).toBe('invitee@example.com');
    expect(event.role).toBe('admin');
    expect(event.token).toBe(result.token);
    expect(event.invitedBy).toBe('u-1');
    expect(event.expiresAt).toBeInstanceOf(Date);
    // The DB stores `sha256(token)`, never the raw token.
    expect(result.invitation.tokenHash).toBe(sha256(result.token));
  });

  it('skips the event when no handler is wired (single-tenant fallback)', async () => {
    const f = buildFixture();
    await expect(
      f.tenantContext.withTenant('acme', async () =>
        f.service.invite({ email: 'x@example.com' }),
      ),
    ).resolves.toBeDefined();
  });

  it('propagates handler errors so callers see the failure', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('mailer down'));
    const f = buildFixture({ onInvitationCreated: boom });
    await expect(
      f.tenantContext.withTenant('acme', async () =>
        f.service.invite({ email: 'x@example.com' }),
      ),
    ).rejects.toThrow('mailer down');
  });

  it('defaults role to "member" and invitedBy to null', async () => {
    const f = buildFixture();
    const result = await f.tenantContext.withTenant('acme', async () =>
      f.service.invite({ email: 'x@example.com' }),
    );
    expect(result.invitation.role).toBe('member');
    expect(result.invitation.invitedBy).toBeNull();
  });

  it('regenerate re-emits the event with a fresh token on the same row', async () => {
    const handler = vi.fn();
    const f = buildFixture({ onInvitationCreated: handler });
    const first = await f.tenantContext.withTenant('acme', async () =>
      f.service.invite({ email: 'invitee@example.com' }),
    );
    handler.mockClear();

    const second = await f.tenantContext.withTenant('acme', async () =>
      f.service.regenerate(first.invitation.id),
    );

    expect(second.invitation.id).toBe(first.invitation.id);
    expect(second.token).not.toBe(first.token);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      invitationId: first.invitation.id,
      token: second.token,
    });
  });
});
