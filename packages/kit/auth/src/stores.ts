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
