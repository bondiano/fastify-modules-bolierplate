/**
 * Provider factory. Selects the active billing adapter based on
 * `config.BILLING_PROVIDER` and validates that the chosen adapter's
 * required config is populated. Adapters lazy-load their vendor SDKs
 * so a service that uses dev-memory in tests doesn't need `stripe`
 * installed.
 */
import type { BillingConfig } from '../config.js';
import { BillingProviderNotConfigured } from '../errors.js';

import { createDevMemoryProvider } from './dev-memory.js';
import { createStripeProvider } from './stripe.js';
import type { BillingProvider } from './types.js';

export type { DevMemoryProvider, DevMemoryCall } from './dev-memory.js';
export type { StripeProviderOptions } from './stripe.js';
export type {
  BillingProvider,
  BillingProviderName,
  BillingWebhookVerifyInput,
  CreateCheckoutSessionInput,
  CreateCustomerInput,
  CreatePortalSessionInput,
  ListInvoicesInput,
  ListSubscriptionsInput,
} from './types.js';

/**
 * Returns the active billing provider for a given config. Throws
 * `BillingProviderNotConfigured` synchronously when required env vars
 * are missing -- the consumer should call this once at startup so a
 * misconfiguration surfaces at boot rather than on the first webhook.
 */
export const createBillingProvider = (
  config: Pick<
    BillingConfig,
    | 'BILLING_PROVIDER'
    | 'STRIPE_SECRET_KEY'
    | 'STRIPE_WEBHOOK_SECRET'
    | 'STRIPE_API_VERSION'
  >,
): BillingProvider => {
  switch (config.BILLING_PROVIDER) {
    case 'dev-memory': {
      return createDevMemoryProvider();
    }
    case 'stripe': {
      if (!config.STRIPE_SECRET_KEY) {
        throw new BillingProviderNotConfigured(
          'BILLING_PROVIDER=stripe requires STRIPE_SECRET_KEY.',
        );
      }
      return createStripeProvider({
        secretKey: config.STRIPE_SECRET_KEY,
        ...(config.STRIPE_WEBHOOK_SECRET
          ? { webhookSecret: config.STRIPE_WEBHOOK_SECRET }
          : {}),
        ...(config.STRIPE_API_VERSION
          ? { apiVersion: config.STRIPE_API_VERSION }
          : {}),
      });
    }
  }
};

export { createDevMemoryProvider } from './dev-memory.js';
export { createStripeProvider } from './stripe.js';
