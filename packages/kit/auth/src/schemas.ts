import { Type, type Static } from '@sinclair/typebox';

export const RegisterBodySchema = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
});
export type RegisterBody = Static<typeof RegisterBodySchema>;

export const LoginBodySchema = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Type.String({ minLength: 1, maxLength: 128 }),
});
export type LoginBody = Static<typeof LoginBodySchema>;

export const RefreshBodySchema = Type.Object({
  refreshToken: Type.String({ minLength: 1 }),
});
export type RefreshBody = Static<typeof RefreshBodySchema>;

export const LogoutBodySchema = Type.Object({
  refreshToken: Type.String({ minLength: 1 }),
});
export type LogoutBody = Static<typeof LogoutBodySchema>;

export const AuthUserSchema = Type.Object({
  id: Type.String(),
  email: Type.String({ format: 'email' }),
  role: Type.String(),
});

export const TokenPairSchema = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.String(),
});

export const AuthResultSchema = Type.Object({
  user: AuthUserSchema,
  tokens: TokenPairSchema,
});

export const RefreshResultSchema = TokenPairSchema;

// -------------------------------------------------------------------------
// Token-based flows (password reset / email verification / OTP)
// -------------------------------------------------------------------------

export const PasswordResetRequestBodySchema = Type.Object({
  email: Type.String({ format: 'email' }),
});
export type PasswordResetRequestBody = Static<
  typeof PasswordResetRequestBodySchema
>;

export const PasswordResetConfirmBodySchema = Type.Object({
  token: Type.String({ minLength: 1 }),
  newPassword: Type.String({ minLength: 8, maxLength: 128 }),
});
export type PasswordResetConfirmBody = Static<
  typeof PasswordResetConfirmBodySchema
>;

export const EmailVerificationConfirmBodySchema = Type.Object({
  token: Type.String({ minLength: 1 }),
});
export type EmailVerificationConfirmBody = Static<
  typeof EmailVerificationConfirmBodySchema
>;

export const OtpRequestBodySchema = Type.Object({
  purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});
export type OtpRequestBody = Static<typeof OtpRequestBodySchema>;

export const OtpVerifyBodySchema = Type.Object({
  code: Type.String({
    minLength: 6,
    maxLength: 6,
    pattern: String.raw`^\d{6}$`,
  }),
  purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});
export type OtpVerifyBody = Static<typeof OtpVerifyBodySchema>;
