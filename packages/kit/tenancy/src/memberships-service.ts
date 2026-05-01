import { createHash, randomBytes } from 'node:crypto';

import type { Insertable, Selectable, Updateable } from 'kysely';

import type { TenantContext } from './context.js';
import {
  InvitationAlreadyAccepted,
  InvitationEmailMismatch,
  InvitationExpired,
  InvitationNotFound,
  MembershipExists,
  MembershipNotFound,
} from './errors.js';
import type {
  InvitationsTable,
  MembershipsTable,
  TenancyDB,
} from './schema.js';

/** Default membership lifetime for an invitation: 7 days in ms. */
const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Byte length of the raw invitation token (32 bytes -> 64 hex chars). */
const INVITATION_TOKEN_BYTES = 32;

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Subset of `MembershipsRepository` consumed by the service. Typed
 * against canonical `MembershipsTable` shapes; the consumer's generic
 * `MembershipsRepository<DB>` satisfies this via covariance in return
 * positions (returning `Selectable<DB['memberships']>` is a subtype of
 * `Selectable<MembershipsTable>`).
 */
export interface MembershipsServiceRepoView {
  findByUserIdInCurrentTenant(
    userId: string,
  ): Promise<Selectable<MembershipsTable> | undefined>;
  create(
    data: Omit<Insertable<MembershipsTable>, 'tenantId'>,
  ): Promise<Selectable<MembershipsTable>>;
  softDelete(id: string): Promise<Selectable<MembershipsTable> | undefined>;
}

/** Subset of `InvitationsRepository` consumed by the service. */
export interface InvitationsServiceRepoView {
  findById(id: string): Promise<Selectable<InvitationsTable> | undefined>;
  findByTokenHash(
    tokenHash: string,
  ): Promise<Selectable<InvitationsTable> | undefined>;
  findPendingByEmail(
    email: string,
  ): Promise<Selectable<InvitationsTable> | undefined>;
  markAccepted(id: string): Promise<Selectable<InvitationsTable> | undefined>;
  create(
    data: Omit<Insertable<InvitationsTable>, 'tenantId'>,
  ): Promise<Selectable<InvitationsTable>>;
  update(
    id: string,
    data: Omit<Updateable<InvitationsTable>, 'tenantId'>,
  ): Promise<Selectable<InvitationsTable> | undefined>;
}

export interface InviteInput {
  readonly email: string;
  /** Role granted when the invitation is accepted. Defaults to `'member'`. */
  readonly role?: string;
  /** User id of the inviter. Nullable so system-generated invites are possible. */
  readonly invitedBy?: string | null;
  /** Lifetime in ms relative to now. Defaults to 7 days. */
  readonly expiresInMs?: number;
}

export interface AcceptInput {
  /** Raw token from the invitation email -- **not** the stored hash. */
  readonly token: string;
  /** Id of the user accepting. The route guard must have verified this user. */
  readonly userId: string;
}

export interface InviteResult {
  /** Persisted invitation row. */
  readonly invitation: Selectable<InvitationsTable>;
  /**
   * Raw token -- only returned here, never persisted. The caller sends it to
   * the invitee (via email, UI, ...). The DB stores `sha256(token)` only.
   */
  readonly token: string;
}

/**
 * Narrow interface for starting a DB transaction. `@kit/db`'s `Trx<DB>` is
 * directly callable with this signature, so consumers pass `transaction`
 * without any casting.
 */
export interface TransactionRunner {
  <T>(callback: () => Promise<T>): Promise<T>;
}

/**
 * Domain event emitted when an invitation is created (or regenerated).
 * The mailer is deliberately decoupled from this package -- the consumer
 * wires a handler that formats and sends the email (real send arrives in
 * `P2.mailer.*`). The raw `token` is included exactly once (it is **not**
 * persisted in the DB beyond its hash) and must be rendered into a
 * one-time accept URL by the handler.
 */
export interface InvitationCreatedEvent {
  readonly invitationId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: string;
  readonly token: string;
  readonly expiresAt: Date;
  readonly invitedBy: string | null;
}

export type InvitationCreatedHandler = (
  event: InvitationCreatedEvent,
) => Promise<void> | void;

export interface MembershipsServiceDeps {
  readonly transaction: TransactionRunner;
  readonly tenantContext: TenantContext;
  readonly membershipsRepository: MembershipsServiceRepoView;
  readonly invitationsRepository: InvitationsServiceRepoView;
  /**
   * Resolves the canonical email for the user accepting an invitation.
   * Used by `accept()` to verify the redeeming user matches the email
   * the invitation was issued to -- a leaked token cannot be redeemed
   * under a different account. Implementations typically call
   * `usersRepository.findByIdGlobally(userId).email`.
   */
  readonly resolveUserEmail: (userId: string) => Promise<string | null>;
  /**
   * Optional best-effort lookup `email -> userId`. When present, `invite()`
   * checks whether the invitee is already an active member of the
   * current tenant and throws `MembershipExists` instead of creating a
   * duplicate invitation. Consumers that don't expose a users repository
   * can omit it; deduplication then falls back to "pending invitation
   * by email" only.
   */
  readonly resolveUserIdByEmail?: (email: string) => Promise<string | null>;
  /**
   * Optional event handler called once per successful `invite()` (and
   * `regenerate()`). Wire this to a mailer adapter (or a queue producer)
   * to deliver the accept link. Errors thrown by the handler bubble up
   * and roll back nothing -- the invitation row is already committed --
   * so handlers should swallow non-fatal failures themselves and log.
   */
  readonly onInvitationCreated?: InvitationCreatedHandler;
}

export interface MembershipsService {
  /**
   * Create a pending invitation in the **current tenant** and return the
   * raw token. Email is normalized (`trim().toLowerCase()`) before any
   * lookup so duplicate invites are detected regardless of caller
   * casing. Throws `MembershipExists` when the email already maps to an
   * active member of the current tenant. When a pending invitation
   * already exists for the same email, the existing row is regenerated
   * (new token, new expiry) instead of creating a duplicate row.
   */
  invite(input: InviteInput): Promise<InviteResult>;
  /**
   * Redeem an invitation. Runs inside a single DB transaction so the
   * markAccepted gate is atomic w.r.t. concurrent accepts. Verifies the
   * accepting user's email matches the invitation's email before
   * consuming the token. On race -> `InvitationAlreadyAccepted` (or
   * `InvitationExpired` if the token also crossed its expiry boundary).
   */
  accept(input: AcceptInput): Promise<Selectable<MembershipsTable>>;
  /**
   * Soft-delete a membership in the **current tenant**. Throws
   * `MembershipNotFound` when the id is unknown or belongs to another
   * tenant. The `(tenant_id, user_id)` partial unique index lets the
   * same user re-join under a fresh row after revocation.
   */
  revoke(membershipId: string): Promise<Selectable<MembershipsTable>>;
  /**
   * Mint a fresh invitation token for an existing pending invitation
   * row (in the **current tenant**). The old `token_hash` is replaced
   * with a new one, `expires_at` is reset to `now + expiresInMs`, and
   * the raw token is returned exactly once -- mirroring `invite()`'s
   * contract. Triggers `onInvitationCreated` so a wired mailer adapter
   * resends the accept link automatically.
   *
   * Throws `InvitationNotFound` if the id is unknown / cross-tenant
   * and `InvitationAlreadyAccepted` if the invitation has already been
   * redeemed.
   */
  regenerate(
    invitationId: string,
    options?: { readonly expiresInMs?: number },
  ): Promise<InviteResult>;
}

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

const newToken = (): { readonly token: string; readonly tokenHash: string } => {
  const token = randomBytes(INVITATION_TOKEN_BYTES).toString('hex');
  return { token, tokenHash: hashToken(token) };
};

export const createMembershipsService = ({
  transaction,
  tenantContext,
  membershipsRepository,
  invitationsRepository,
  resolveUserEmail,
  resolveUserIdByEmail,
  onInvitationCreated,
}: MembershipsServiceDeps): MembershipsService => {
  const fireCreated = async (
    invitation: Selectable<InvitationsTable>,
    token: string,
  ): Promise<void> => {
    if (!onInvitationCreated) return;
    await onInvitationCreated({
      invitationId: invitation.id,
      tenantId: invitation.tenantId,
      email: invitation.email,
      role: invitation.role,
      token,
      expiresAt: new Date(invitation.expiresAt),
      invitedBy: invitation.invitedBy,
    });
  };

  const regenerateImpl = async (
    invitationId: string,
    expiresInMs: number,
  ): Promise<InviteResult> => {
    const existing = await invitationsRepository.findById(invitationId);
    if (!existing) throw new InvitationNotFound(invitationId);
    if (existing.acceptedAt !== null) throw new InvitationAlreadyAccepted();

    const { token, tokenHash } = newToken();
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString();

    const invitation = await invitationsRepository.update(invitationId, {
      tokenHash,
      expiresAt,
    });
    if (!invitation) throw new InvitationNotFound(invitationId);

    await fireCreated(invitation, token);
    return { invitation, token };
  };

  return {
    invite: async ({
      email,
      role = 'member',
      invitedBy = null,
      expiresInMs = DEFAULT_INVITATION_TTL_MS,
    }) => {
      const normalizedEmail = normalizeEmail(email);

      // Reject re-invitations for users who are already active members.
      if (resolveUserIdByEmail) {
        const userId = await resolveUserIdByEmail(normalizedEmail);
        if (userId) {
          const existing =
            await membershipsRepository.findByUserIdInCurrentTenant(userId);
          if (existing) throw new MembershipExists(existing.id);
        }
      }

      // Dedupe pending invitations: refresh the existing row instead of
      // creating a parallel one with a competing token.
      const pending =
        await invitationsRepository.findPendingByEmail(normalizedEmail);
      if (pending) return regenerateImpl(pending.id, expiresInMs);

      const { token, tokenHash } = newToken();
      const expiresAt = new Date(Date.now() + expiresInMs).toISOString();

      const invitation = await invitationsRepository.create({
        email: normalizedEmail,
        role,
        tokenHash,
        invitedBy,
        expiresAt,
        acceptedAt: null,
      });

      await fireCreated(invitation, token);
      return { invitation, token };
    },

    accept: async ({ token, userId }) => {
      const tokenHash = hashToken(token);

      return transaction(async () => {
        const invitation =
          await invitationsRepository.findByTokenHash(tokenHash);
        if (!invitation) throw new InvitationNotFound();

        // Email guard: a leaked token must not be redeemable under a
        // different account. Compare canonicalized emails to absorb
        // capitalization drift.
        const userEmail = await resolveUserEmail(userId);
        if (
          !userEmail ||
          normalizeEmail(userEmail) !== normalizeEmail(invitation.email)
        ) {
          throw new InvitationEmailMismatch();
        }

        // markAccepted is the atomic gate: the WHERE clause filters on
        // `acceptedAt IS NULL AND expires_at > now() AND deletedAt IS NULL`,
        // so concurrent accepts cannot both succeed. Open the tenant
        // frame BEFORE markAccepted so the scoped UPDATE finds the row.
        return tenantContext.withTenant(invitation.tenantId, async () => {
          const accepted = await invitationsRepository.markAccepted(
            invitation.id,
          );
          if (!accepted) {
            // Either already accepted, expired, or revoked. The pre-read
            // captured the state before our UPDATE so we can disambiguate
            // for a clearer error -- the canonical case is "raced and
            // lost", which is `InvitationAlreadyAccepted`.
            if (invitation.acceptedAt !== null) {
              throw new InvitationAlreadyAccepted();
            }
            if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
              throw new InvitationExpired();
            }
            throw new InvitationAlreadyAccepted();
          }

          const existing =
            await membershipsRepository.findByUserIdInCurrentTenant(userId);
          if (existing) return existing;

          return membershipsRepository.create({
            userId,
            role: accepted.role,
            invitedBy: accepted.invitedBy,
            joinedAt: new Date().toISOString(),
          });
        });
      });
    },

    revoke: async (membershipId) => {
      const deleted = await membershipsRepository.softDelete(membershipId);
      if (!deleted) throw new MembershipNotFound(membershipId);
      return deleted;
    },

    regenerate: async (
      invitationId,
      { expiresInMs = DEFAULT_INVITATION_TTL_MS } = {},
    ) => regenerateImpl(invitationId, expiresInMs),
  };
};

/**
 * Maintained for back-compat: the consumer wrappers in services/api
 * import the type as `MembershipsService<DB>` -- the generic is now a
 * no-op, kept only so call sites don't need to drop the angle-brackets.
 */
export type MembershipsServiceFor<_DB extends TenancyDB> = MembershipsService;
