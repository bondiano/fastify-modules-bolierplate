import { asFunction, Lifetime } from 'awilix';

import type { ContainerProvider } from '@kit/core/di';

import {
  createAuthService,
  type AuthService,
  type OnEmailVerificationRequested,
  type OnOtpRequested,
  type OnPasswordResetRequested,
} from './auth.service.js';
import { createPasswordHasher, type PasswordHasher } from './password.js';
import type {
  EmailVerificationTokenStore,
  OtpCodeStore,
  PasswordResetTokenStore,
  TokenBlacklistStore,
  UserStore,
} from './stores.js';
import { createTokenService, type TokenService } from './tokens.js';

declare global {
  interface Dependencies {
    passwordHasher: PasswordHasher;
    tokenService: TokenService;
    userStore: UserStore;
    tokenBlacklistStore: TokenBlacklistStore;
    passwordResetTokenStore: PasswordResetTokenStore;
    emailVerificationTokenStore: EmailVerificationTokenStore;
    otpCodeStore: OtpCodeStore;
    authService: AuthService;
  }
}

export interface AuthProviderOptions {
  /**
   * Resolve the `UserStore` from the DI cradle. Called lazily at resolution
   * time, so module-level repositories are available.
   */
  resolveUserStore: (deps: Dependencies) => UserStore;
  /**
   * Resolve the `TokenBlacklistStore` from the DI cradle.
   */
  resolveTokenBlacklistStore: (deps: Dependencies) => TokenBlacklistStore;
  /** Lazy resolver for the password-reset token store. */
  resolvePasswordResetTokenStore: (
    deps: Dependencies,
  ) => PasswordResetTokenStore;
  /** Lazy resolver for the email-verification token store. */
  resolveEmailVerificationTokenStore: (
    deps: Dependencies,
  ) => EmailVerificationTokenStore;
  /** Lazy resolver for the OTP store. */
  resolveOtpCodeStore: (deps: Dependencies) => OtpCodeStore;
  /** Optional mailer-style event handlers. Each is invoked AFTER the
   * matching DB row is committed; throws propagate. Leave any unset to
   * skip the side-effect (useful for tests / pre-mailer dev). */
  onPasswordResetRequested?: OnPasswordResetRequested;
  onEmailVerificationRequested?: OnEmailVerificationRequested;
  onOtpRequested?: OnOtpRequested;
}

/**
 * Registers auth infrastructure services into the DI container:
 * `passwordHasher`, `tokenService`, `userStore`, `tokenBlacklistStore`,
 * `passwordResetTokenStore`, `emailVerificationTokenStore`,
 * `otpCodeStore`, and `authService`.
 *
 * Requires `config` (with auth fields) to already be in the cradle.
 */
export const authProvider =
  (options: AuthProviderOptions): ContainerProvider =>
  (container) => {
    container.register({
      passwordHasher: asFunction(createPasswordHasher, {
        lifetime: Lifetime.SINGLETON,
      }),
      tokenService: asFunction(createTokenService, {
        lifetime: Lifetime.SINGLETON,
      }),
      userStore: asFunction(options.resolveUserStore, {
        lifetime: Lifetime.SINGLETON,
      }),
      tokenBlacklistStore: asFunction(options.resolveTokenBlacklistStore, {
        lifetime: Lifetime.SINGLETON,
      }),
      passwordResetTokenStore: asFunction(
        options.resolvePasswordResetTokenStore,
        { lifetime: Lifetime.SINGLETON },
      ),
      emailVerificationTokenStore: asFunction(
        options.resolveEmailVerificationTokenStore,
        { lifetime: Lifetime.SINGLETON },
      ),
      otpCodeStore: asFunction(options.resolveOtpCodeStore, {
        lifetime: Lifetime.SINGLETON,
      }),
      authService: asFunction(
        (cradle: Dependencies) =>
          createAuthService({
            userStore: cradle.userStore,
            tokenBlacklistStore: cradle.tokenBlacklistStore,
            passwordResetTokenStore: cradle.passwordResetTokenStore,
            emailVerificationTokenStore: cradle.emailVerificationTokenStore,
            otpCodeStore: cradle.otpCodeStore,
            passwordHasher: cradle.passwordHasher,
            tokenService: cradle.tokenService,
            // The kit's `Dependencies.config` is intentionally weakly
            // typed (`Record<string, unknown>`); cast at the boundary
            // since the consumer is responsible for merging
            // `authConfigSchema` into their service config.
            config: cradle.config as unknown as Parameters<
              typeof createAuthService
            >[0]['config'],
            ...(options.onPasswordResetRequested
              ? { onPasswordResetRequested: options.onPasswordResetRequested }
              : {}),
            ...(options.onEmailVerificationRequested
              ? {
                  onEmailVerificationRequested:
                    options.onEmailVerificationRequested,
                }
              : {}),
            ...(options.onOtpRequested
              ? { onOtpRequested: options.onOtpRequested }
              : {}),
          }),
        { lifetime: Lifetime.SINGLETON },
      ),
    });
  };
