import { z } from 'zod';

/**
 * Config schema fragment for `@kit/billing`. Merge into your app config
 * via `createConfig({ ...billingConfigSchema })` in
 * `services/<svc>/src/config.ts`.
 *
 * Provider-specific fields are all optional; runtime startup verifies
 * that the active `BILLING_PROVIDER`'s required fields are populated and
 * throws `BillingProviderNotConfigured` at boot otherwise.
 */
export const billingConfigSchema = {
  /** Selects which billing provider adapter is used. `dev-memory` keeps
   * checkout sessions / subscriptions in-process for tests. */
  BILLING_PROVIDER: z.enum(['stripe', 'dev-memory']).default('dev-memory'),

  // ---------- Stripe ----------
  /** Server-side secret key (`sk_test_...` / `sk_live_...`). */
  STRIPE_SECRET_KEY: z.string().optional(),
  /** Webhook signing secret (`whsec_...`). Used by
   * `stripe.webhooks.constructEvent`. */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Publishable key (`pk_test_...`); surfaced to the client by the
   * service if it ever ships a Stripe.js-driven UI. Not used by the
   * server-side flow itself. */
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  /** Optional Stripe API version override. Defaults to the SDK's pinned
   * version, which is what we test against. */
  STRIPE_API_VERSION: z.string().optional(),
};

// `exactOptionalPropertyTypes: true` requires optional fields to be
// declared as `T | undefined` -- otherwise a Zod-inferred config (which
// always includes `undefined` for `.optional()` schemas) can't flow
// through `Pick<BillingConfig, ...>` without a structural coercion error.
export type BillingConfig = {
  BILLING_PROVIDER: 'stripe' | 'dev-memory';
  STRIPE_SECRET_KEY: string | undefined;
  STRIPE_WEBHOOK_SECRET: string | undefined;
  STRIPE_PUBLISHABLE_KEY: string | undefined;
  STRIPE_API_VERSION: string | undefined;
};
