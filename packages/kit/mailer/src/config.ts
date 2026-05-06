import { z } from 'zod';

/**
 * Config schema fragment for `@kit/mailer`. Merge into your app config
 * via `createConfig({ ...mailerConfigSchema })` in `services/<svc>/src/config.ts`.
 *
 * Provider-specific fields are all optional; runtime startup verifies
 * that the active `MAILER_PROVIDER`'s required fields are populated and
 * throws a clear error on the first send if not.
 */
export const mailerConfigSchema = {
  /** Selects which transport adapter is used. `dev-memory` keeps mail
   * in-process for tests and offline dev. */
  MAILER_PROVIDER: z
    .enum(['smtp', 'ses', 'resend', 'postmark', 'dev-memory'])
    .default('dev-memory'),
  /** Default `from` address used when no per-tenant override is set or
   * verified. Must be a real address you own + have DNS-verified with
   * the active provider. */
  MAIL_FROM: z.string().default('noreply@example.com'),
  MAIL_FROM_NAME: z.string().optional(),

  // ---------- SMTP ----------
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),

  // ---------- AWS SES ----------
  AWS_SES_REGION: z.string().optional(),
  AWS_SES_ACCESS_KEY_ID: z.string().optional(),
  AWS_SES_SECRET_ACCESS_KEY: z.string().optional(),
  /** SES SNS subscription confirmation token verification secret. Without
   * this the webhook receiver will accept any payload claiming to be SES. */
  AWS_SNS_TOPIC_ARN: z.string().optional(),

  // ---------- Resend ----------
  RESEND_API_KEY: z.string().optional(),
  /** Resend webhook signing secret (used by HMAC verifier). */
  RESEND_WEBHOOK_SECRET: z.string().optional(),

  // ---------- Postmark ----------
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  /** Postmark webhook auth (HTTP Basic). Username + password. */
  POSTMARK_WEBHOOK_USER: z.string().optional(),
  POSTMARK_WEBHOOK_PASSWORD: z.string().optional(),
};

// `exactOptionalPropertyTypes: true` requires optional fields to be
// declared as `T | undefined` -- otherwise a Zod-inferred config
// (which always includes `undefined` for `.optional()` schemas) can't
// flow through `Pick<MailerConfig, ...>` without a structural coercion
// error.
export type MailerConfig = {
  MAILER_PROVIDER: 'smtp' | 'ses' | 'resend' | 'postmark' | 'dev-memory';
  MAIL_FROM: string;
  MAIL_FROM_NAME: string | undefined;
  SMTP_HOST: string | undefined;
  SMTP_PORT: number | undefined;
  SMTP_USER: string | undefined;
  SMTP_PASSWORD: string | undefined;
  SMTP_SECURE: boolean;
  AWS_SES_REGION: string | undefined;
  AWS_SES_ACCESS_KEY_ID: string | undefined;
  AWS_SES_SECRET_ACCESS_KEY: string | undefined;
  AWS_SNS_TOPIC_ARN: string | undefined;
  RESEND_API_KEY: string | undefined;
  RESEND_WEBHOOK_SECRET: string | undefined;
  POSTMARK_SERVER_TOKEN: string | undefined;
  POSTMARK_WEBHOOK_USER: string | undefined;
  POSTMARK_WEBHOOK_PASSWORD: string | undefined;
};
