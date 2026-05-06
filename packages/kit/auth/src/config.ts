import { z } from 'zod';

/**
 * Config schema fragment for authentication.
 * Merge into your app-level config schema via `createConfig({ ...authConfigSchema })`.
 *
 * TTLs accept any value parseable by `jose`'s `setExpirationTime` (e.g. `15m`,
 * `14d`, `3600`). Stored as strings; the token service hands them straight to
 * jose without further parsing.
 */
export const authConfigSchema = {
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('fastify-saas-kit'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('14d'),
  /** Password reset token lifetime in minutes (default 60). */
  PASSWORD_RESET_TTL_MIN: z.coerce.number().int().min(1).default(60),
  /** Email verification token lifetime in hours (default 24). */
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).default(24),
  /** OTP code lifetime in minutes (default 5). */
  OTP_TTL_MIN: z.coerce.number().int().min(1).default(5),
  /** Max OTP verify attempts before lockout (default 5). */
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
};

export type AuthConfig = {
  JWT_SECRET: string;
  JWT_ISSUER: string;
  ACCESS_TOKEN_TTL: string;
  REFRESH_TOKEN_TTL: string;
  PASSWORD_RESET_TTL_MIN: number;
  EMAIL_VERIFICATION_TTL_HOURS: number;
  OTP_TTL_MIN: number;
  OTP_MAX_ATTEMPTS: number;
};

/**
 * OAuth config fragment. Merge alongside `authConfigSchema` via
 * `createConfig({ ...authConfigSchema, ...oauthConfigSchema })`.
 *
 * Per-provider client id + secret are optional -- the registry only
 * instantiates a provider when both are present. Apple + Microsoft
 * are scaffolded for `P3.social.*` but the kit's v1 only ships
 * Google + GitHub.
 */
export const oauthConfigSchema = {
  /** Public-facing redirect URI base. The kit appends `/auth/oauth/:p/callback`. */
  OAUTH_REDIRECT_BASE_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
};

export type OAuthConfig = {
  OAUTH_REDIRECT_BASE_URL: string | undefined;
  GOOGLE_CLIENT_ID: string | undefined;
  GOOGLE_CLIENT_SECRET: string | undefined;
  GITHUB_CLIENT_ID: string | undefined;
  GITHUB_CLIENT_SECRET: string | undefined;
};
