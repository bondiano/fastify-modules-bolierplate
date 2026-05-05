/**
 * Auth module-level types. The kit-side `@kit/auth/provider` declares
 * the cradle additions for `passwordHasher` / `tokenService` /
 * `userStore` / `tokenBlacklistStore` / `passwordResetTokenStore` /
 * `emailVerificationTokenStore` / `otpCodeStore` / `authService` so this
 * file only carries service-specific repository wiring.
 */
import type { EmailVerificationTokenRepository } from './email-verification-token.repository.ts';
import type { OtpCodeRepository } from './otp-code.repository.ts';
import type { PasswordResetTokenRepository } from './password-reset-token.repository.ts';

declare global {
  interface Dependencies {
    passwordResetTokenRepository: PasswordResetTokenRepository;
    emailVerificationTokenRepository: EmailVerificationTokenRepository;
    otpCodeRepository: OtpCodeRepository;
  }
}
