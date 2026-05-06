/**
 * Storage interfaces the auth service depends on. The consuming service
 * implements these so this package stays free of any specific ORM or
 * Redis client coupling.
 */

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  /** Set when the user has confirmed ownership of `email`. `null` means
   * unverified -- routes guarded by `fastify.requireVerifiedEmail` will
   * 403 until this flips. */
  emailVerifiedAt: Date | null;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  role?: string;
}

export interface UserStore {
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  create(input: CreateUserInput): Promise<AuthUser>;
  /** Replace a user's `passwordHash` with a freshly hashed value.
   * Called from `confirmPasswordReset` and from the admin "Force
   * password reset" action. Implementations MUST NOT trigger a session
   * clear here -- the auth service does that explicitly afterwards. */
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  /** Stamp `emailVerifiedAt = now()` on the user row. Idempotent: if
   * already verified, the call is a no-op. */
  markEmailVerified(userId: string): Promise<void>;
}

// -------------------------------------------------------------------------
// Token-based flow stores (password reset / email verify / OTP)
// -------------------------------------------------------------------------

export interface PasswordResetTokenRow {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

export interface PasswordResetTokenStore {
  /** Persist a freshly-issued token (caller hashes the raw value). */
  create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  /** Lookup by hash -- raw tokens never reach the DB. */
  findByTokenHash(tokenHash: string): Promise<PasswordResetTokenRow | null>;
  /** Atomic single-use guard: marks the row used iff `used_at IS NULL`.
   * Returns `false` when the token has already been redeemed (the
   * caller should treat this as a generic "invalid token" failure to
   * avoid leaking which step blocked it). */
  markUsed(id: string): Promise<boolean>;
  /** Sweep helper for the cleanup job. */
  pruneExpired(now: Date): Promise<{ deleted: number }>;
}

export interface EmailVerificationTokenRow {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly expiresAt: Date;
  readonly verifiedAt: Date | null;
}

export interface EmailVerificationTokenStore {
  create(input: {
    userId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<EmailVerificationTokenRow | null>;
  markVerified(id: string): Promise<boolean>;
  pruneExpired(now: Date): Promise<{ deleted: number }>;
}

export interface OtpCodeRow {
  readonly id: string;
  readonly userId: string;
  readonly purpose: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly attempts: number;
}

export interface OtpCodeStore {
  create(input: {
    userId: string;
    purpose: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<void>;
  /** Pick the freshest live (`used_at IS NULL`) code for a (user, purpose)
   * pair so a user requesting a second code invalidates the first via
   * `markUsed` rather than spawning a parallel slot. */
  findActive(input: {
    userId: string;
    purpose: string;
  }): Promise<OtpCodeRow | null>;
  /** Atomic increment of `attempts`. Returns the new attempt count. */
  incrementAttempts(id: string): Promise<number>;
  markUsed(id: string): Promise<boolean>;
  pruneExpired(now: Date): Promise<{ deleted: number }>;
}

// -------------------------------------------------------------------------
// OAuth identities (P2.social.*)
// -------------------------------------------------------------------------

export interface UserIdentityRow {
  readonly id: string;
  readonly userId: string;
  readonly provider: 'google' | 'github' | 'apple' | 'microsoft';
  readonly providerUserId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly rawProfile: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface CreateUserIdentityInput {
  userId: string;
  provider: 'google' | 'github' | 'apple' | 'microsoft';
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  rawProfile: Record<string, unknown>;
}

export interface UserIdentitiesStore {
  findByProviderUserId(
    provider: string,
    providerUserId: string,
  ): Promise<UserIdentityRow | null>;
  findByUserId(userId: string): Promise<readonly UserIdentityRow[]>;
  create(input: CreateUserIdentityInput): Promise<UserIdentityRow>;
  delete(id: string): Promise<void>;
  countForUser(userId: string): Promise<number>;
}

/**
 * Redis-backed token blacklist for JWT revocation.
 *
 * - `blacklistToken(jti, ttlSeconds)` -- blacklists a single token (logout).
 *   TTL should be refresh token TTL + buffer so the key auto-expires after
 *   the token itself would have expired.
 * - `isBlacklisted(jti)` -- returns true if the token jti is in the blacklist.
 * - `setClearedAt(userId, timestamp, ttlSeconds)` -- sets a "sessions cleared"
 *   timestamp for a user (clear-sessions). Any token issued before this
 *   timestamp is considered revoked.
 * - `getClearedAt(userId)` -- returns the cleared-at timestamp, or null.
 */
export interface TokenBlacklistStore {
  blacklistToken(jti: string, ttlSeconds: number): Promise<void>;
  isBlacklisted(jti: string): Promise<boolean>;
  setClearedAt(
    userId: string,
    timestamp: number,
    ttlSeconds: number,
  ): Promise<void>;
  getClearedAt(userId: string): Promise<number | null>;
}
