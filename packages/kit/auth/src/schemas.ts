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
