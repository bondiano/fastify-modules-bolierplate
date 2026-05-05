import type { AuthConfig } from './config.js';
import {
  InvalidCredentialsError,
  InvalidTokenError,
  InvalidTokenFlowError,
  OtpLockedOutError,
  TokenRevokedError,
  UserAlreadyExistsError,
} from './errors.js';
import type { PasswordHasher } from './password.js';
import type {
  AuthUser,
  EmailVerificationTokenStore,
  OtpCodeStore,
  PasswordResetTokenStore,
  TokenBlacklistStore,
  UserStore,
} from './stores.js';
import {
  generateOtpCode,
  generateUrlSafeToken,
  hashToken,
} from './token-utilities.js';
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

/** Event payload fired by `requestPasswordReset` AFTER the row is
 * persisted. The raw `token` is emitted exactly once -- the DB stores
 * `sha256(token)` only. Consumers wire a mailer adapter on this hook;
 * errors propagate and are the consumer's responsibility to swallow. */
export interface PasswordResetRequestedEvent {
  readonly userId: string;
  readonly email: string;
  readonly token: string;
  readonly expiresAt: Date;
}
export type OnPasswordResetRequested = (
  event: PasswordResetRequestedEvent,
) => Promise<void> | void;

export interface EmailVerificationRequestedEvent {
  readonly userId: string;
  readonly email: string;
  readonly token: string;
  readonly expiresAt: Date;
}
export type OnEmailVerificationRequested = (
  event: EmailVerificationRequestedEvent,
) => Promise<void> | void;

export interface OtpRequestedEvent {
  readonly userId: string;
  readonly email: string;
  readonly purpose: string;
  readonly code: string;
  readonly expiresAt: Date;
}
export type OnOtpRequested = (event: OtpRequestedEvent) => Promise<void> | void;

export interface RequestOtpInput {
  readonly userId: string;
  readonly purpose?: string;
}

export interface VerifyOtpInput {
  readonly userId: string;
  readonly code: string;
  readonly purpose?: string;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<TokenPair>;
  /** Blacklists a single refresh token by its jti. */
  logout(refreshToken: string): Promise<void>;
  /** Sets a clearedAt timestamp -- all tokens issued before it are rejected. */
  clearSessions(userId: string): Promise<void>;
  /** Always 204-equivalent (`void` return); fires the event only when
   * the email belongs to a real account. Pair with route-level rate
   * limiting to make enumeration via timing infeasible. */
  requestPasswordReset(email: string): Promise<void>;
  /** Verifies the token, hashes the new password, updates the user,
   * marks the token used, and clears all existing sessions. Throws
   * `InvalidTokenFlowError` for any failure (expired / used / unknown).
   * The session-clear ensures a stolen-token attacker cannot keep a
   * stale access token alive after the legitimate user resets. */
  confirmPasswordReset(token: string, newPassword: string): Promise<void>;
  /** Mints a fresh email-verification token for the user. The optional
   * `email` argument lets the caller verify a NEW address (email-change
   * flow); when omitted, the user's current email is used. */
  requestEmailVerification(userId: string, email?: string): Promise<void>;
  /** Verifies the token, stamps `users.email_verified_at = now()`, and
   * marks the token verified. Idempotent for an already-verified
   * email. */
  confirmEmailVerification(token: string): Promise<void>;
  /** Mints a 6-digit OTP for `userId`. If a live OTP exists for the
   * same `(userId, purpose)`, it is invalidated atomically before the
   * fresh code is persisted -- so a user who requests twice can only
   * redeem the latest. Default `purpose` is `'mfa-challenge'`. */
  requestOtp(input: RequestOtpInput): Promise<void>;
  /** Verifies an OTP. Increments the row's `attempts` BEFORE checking
   * the hash. Throws `OtpLockedOutError` once `attempts >= OTP_MAX_ATTEMPTS`
   * (the row is also marked used, so further attempts hit `InvalidTokenFlowError`).
   * On success, marks the row used and returns the verification timestamp. */
  verifyOtp(input: VerifyOtpInput): Promise<{ verifiedAt: Date }>;
}

export interface CreateAuthServiceDeps {
  userStore: UserStore;
  tokenBlacklistStore: TokenBlacklistStore;
  passwordResetTokenStore: PasswordResetTokenStore;
  emailVerificationTokenStore: EmailVerificationTokenStore;
  otpCodeStore: OtpCodeStore;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  config: Pick<
    AuthConfig,
    | 'PASSWORD_RESET_TTL_MIN'
    | 'EMAIL_VERIFICATION_TTL_HOURS'
    | 'OTP_TTL_MIN'
    | 'OTP_MAX_ATTEMPTS'
  >;
  /** Optional mailer hooks. Each fires AFTER the corresponding row is
   * persisted; errors propagate and are the consumer's responsibility
   * to log. Leaving any of these unset is supported -- the flow still
   * works (e.g. for tests or pre-mailer dev). */
  onPasswordResetRequested?: OnPasswordResetRequested;
  onEmailVerificationRequested?: OnEmailVerificationRequested;
  onOtpRequested?: OnOtpRequested;
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
  passwordResetTokenStore,
  emailVerificationTokenStore,
  otpCodeStore,
  passwordHasher,
  tokenService,
  config,
  onPasswordResetRequested,
  onEmailVerificationRequested,
  onOtpRequested,
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

    async requestPasswordReset(email) {
      const user = await userStore.findByEmail(email);
      // Always silently succeed if the email is unknown -- otherwise the
      // endpoint becomes an account-enumeration oracle. Rate limiting on
      // the route makes the timing path noisy.
      if (!user) return;

      const token = generateUrlSafeToken(32);
      const expiresAt = new Date(
        Date.now() + config.PASSWORD_RESET_TTL_MIN * 60 * 1000,
      );
      await passwordResetTokenStore.create({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
      });
      if (onPasswordResetRequested) {
        await onPasswordResetRequested({
          userId: user.id,
          email: user.email,
          token,
          expiresAt,
        });
      }
    },

    async confirmPasswordReset(token, newPassword) {
      const row = await passwordResetTokenStore.findByTokenHash(
        hashToken(token),
      );
      // Collapse "no row", "expired", "already used" into one error.
      if (
        !row ||
        row.usedAt !== null ||
        row.expiresAt.getTime() <= Date.now()
      ) {
        throw new InvalidTokenFlowError();
      }
      const used = await passwordResetTokenStore.markUsed(row.id);
      if (!used) throw new InvalidTokenFlowError();

      const passwordHash = await passwordHasher.hash(newPassword);
      await userStore.updatePasswordHash(row.userId, passwordHash);
      // A reset implies a credential rotation; invalidate every live
      // session so a leaked access token can't keep using the account.
      const now = Math.floor(Date.now() / 1000);
      await tokenBlacklistStore.setClearedAt(row.userId, now, blacklistTtl);
    },

    async requestEmailVerification(userId, email) {
      const user = await userStore.findById(userId);
      if (!user) return;
      const target = email ?? user.email;

      const rawToken = generateUrlSafeToken(32);
      const expiresAt = new Date(
        Date.now() + config.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
      );
      await emailVerificationTokenStore.create({
        userId: user.id,
        email: target,
        tokenHash: hashToken(rawToken),
        expiresAt,
      });
      if (onEmailVerificationRequested) {
        await onEmailVerificationRequested({
          userId: user.id,
          email: target,
          token: rawToken,
          expiresAt,
        });
      }
    },

    async confirmEmailVerification(token) {
      const row = await emailVerificationTokenStore.findByTokenHash(
        hashToken(token),
      );
      if (!row || row.expiresAt.getTime() <= Date.now()) {
        throw new InvalidTokenFlowError();
      }
      // Idempotent: an already-verified token returns success silently.
      if (row.verifiedAt !== null) {
        await userStore.markEmailVerified(row.userId);
        return;
      }
      const marked = await emailVerificationTokenStore.markVerified(row.id);
      if (!marked) throw new InvalidTokenFlowError();
      await userStore.markEmailVerified(row.userId);
    },

    async requestOtp({ userId, purpose = 'mfa-challenge' }) {
      const user = await userStore.findById(userId);
      if (!user) return;

      // Invalidate any existing live code for the same (user, purpose)
      // pair so a "request again" flow doesn't leave parallel codes
      // floating around.
      const existing = await otpCodeStore.findActive({ userId, purpose });
      if (existing) await otpCodeStore.markUsed(existing.id);

      const code = generateOtpCode();
      const expiresAt = new Date(Date.now() + config.OTP_TTL_MIN * 60 * 1000);
      await otpCodeStore.create({
        userId,
        purpose,
        codeHash: hashToken(code),
        expiresAt,
      });
      if (onOtpRequested) {
        await onOtpRequested({
          userId,
          email: user.email,
          purpose,
          code,
          expiresAt,
        });
      }
    },

    async verifyOtp({ userId, code, purpose = 'mfa-challenge' }) {
      const active = await otpCodeStore.findActive({ userId, purpose });
      if (!active || active.expiresAt.getTime() <= Date.now()) {
        throw new InvalidTokenFlowError();
      }

      // Bump attempts FIRST so a slow `compareTokens` can't be replayed
      // for free. Lockout when the post-increment count reaches max.
      const attempts = await otpCodeStore.incrementAttempts(active.id);
      if (attempts > config.OTP_MAX_ATTEMPTS) {
        await otpCodeStore.markUsed(active.id);
        throw new OtpLockedOutError();
      }

      if (active.codeHash !== hashToken(code)) {
        if (attempts >= config.OTP_MAX_ATTEMPTS) {
          await otpCodeStore.markUsed(active.id);
          throw new OtpLockedOutError();
        }
        throw new InvalidTokenFlowError();
      }

      const marked = await otpCodeStore.markUsed(active.id);
      if (!marked) throw new InvalidTokenFlowError();
      return { verifiedAt: new Date() };
    },
  };
};
