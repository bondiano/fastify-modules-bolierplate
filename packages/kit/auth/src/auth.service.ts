import {
  InvalidCredentialsError,
  InvalidTokenError,
  TokenRevokedError,
  UserAlreadyExistsError,
} from './errors.js';
import type { PasswordHasher } from './password.js';
import type { AuthUser, TokenBlacklistStore, UserStore } from './stores.js';
import type { TokenService } from './tokens.js';

export interface RegisterInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: Omit<AuthUser, 'passwordHash'>;
  tokens: TokenPair;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<TokenPair>;
  /** Blacklists a single refresh token by its jti. */
  logout(refreshToken: string): Promise<void>;
  /** Sets a clearedAt timestamp -- all tokens issued before it are rejected. */
  clearSessions(userId: string): Promise<void>;
}

export interface CreateAuthServiceDeps {
  userStore: UserStore;
  tokenBlacklistStore: TokenBlacklistStore;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
}

/** Buffer added to refresh TTL for blacklist key expiry (6 hours). */
const BLACKLIST_BUFFER_SECONDS = 6 * 3600;

const stripPassword = ({ passwordHash: _passwordHash, ...rest }: AuthUser) =>
  rest;

/**
 * Fully stateless auth service. Both access and refresh tokens are JWTs.
 * Revocation is handled via a Redis blacklist:
 * - `logout` blacklists the refresh token's jti.
 * - `clearSessions` sets a per-user clearedAt timestamp; any token with
 *   iat < clearedAt is rejected.
 */
export const createAuthService = ({
  userStore,
  tokenBlacklistStore,
  passwordHasher,
  tokenService,
}: CreateAuthServiceDeps): AuthService => {
  const blacklistTtl =
    tokenService.refreshTtlSeconds + BLACKLIST_BUFFER_SECONDS;

  const issueTokenPair = async (user: AuthUser): Promise<TokenPair> => {
    const input = { userId: user.id, role: user.role };
    const [accessToken, refreshToken] = await Promise.all([
      tokenService.signAccessToken(input),
      tokenService.signRefreshToken(input),
    ]);
    return { accessToken, refreshToken };
  };

  /** Check that a token's jti is not blacklisted and iat is after clearedAt. */
  const assertNotRevoked = async (
    jti: string,
    iat: number,
    userId: string,
  ): Promise<void> => {
    const [blacklisted, clearedAt] = await Promise.all([
      tokenBlacklistStore.isBlacklisted(jti),
      tokenBlacklistStore.getClearedAt(userId),
    ]);
    if (blacklisted) throw new TokenRevokedError();
    if (clearedAt !== null && iat < clearedAt)
      throw new TokenRevokedError('All sessions cleared');
  };

  return {
    async register({ email, password }) {
      const existing = await userStore.findByEmail(email);
      if (existing) throw new UserAlreadyExistsError();

      const passwordHash = await passwordHasher.hash(password);
      const user = await userStore.create({ email, passwordHash });
      const tokens = await issueTokenPair(user);
      return { user: stripPassword(user), tokens };
    },

    async login({ email, password }) {
      const user = await userStore.findByEmail(email);
      // Run verify even if user is missing to keep timing roughly even.
      const ok = user
        ? await passwordHasher.verify(user.passwordHash, password)
        : await passwordHasher
            .verify(
              '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$Z0Z0Z0Z0Z0Z0Z0Z0Z0Z0Zw',
              password,
            )
            .catch(() => false);
      if (!user || !ok) throw new InvalidCredentialsError();

      const tokens = await issueTokenPair(user);
      return { user: stripPassword(user), tokens };
    },

    async refresh(refreshToken) {
      const payload = await tokenService.verifyRefreshToken(refreshToken);
      await assertNotRevoked(payload.jti, payload.iat, payload.sub);

      const user = await userStore.findById(payload.sub);
      if (!user) throw new InvalidTokenError();

      // Blacklist the old refresh token, then issue a fresh pair.
      await tokenBlacklistStore.blacklistToken(payload.jti, blacklistTtl);
      return issueTokenPair(user);
    },

    async logout(refreshToken) {
      try {
        const payload = await tokenService.verifyRefreshToken(refreshToken);
        await tokenBlacklistStore.blacklistToken(payload.jti, blacklistTtl);
      } catch {
        // Silently ignore invalid/expired tokens on logout.
      }
    },

    async clearSessions(userId) {
      const now = Math.floor(Date.now() / 1000);
      await tokenBlacklistStore.setClearedAt(userId, now, blacklistTtl);
    },
  };
};
