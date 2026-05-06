/**
 * In-process billing provider for tests + offline dev. Captures every
 * call onto an array exposed as `provider.calls`; tests assert against
 * it directly.
 *
 * Webhook verification: returns whatever events the test pushes onto
 * `provider.queueEvent(...)` -- there's no signature scheme; the
 * receiver route bypasses signature verification when the configured
 * provider is `dev-memory`.
 */
import type { BillingEvent } from '../events.js';

import type {
  BillingProvider,
  CreateCheckoutSessionInput,
  CreateCustomerInput,
  CreatePortalSessionInput,
  ListInvoicesInput,
  ListSubscriptionsInput,
} from './types.js';

export type DevMemoryCall =
  | { readonly kind: 'createCustomer'; readonly input: CreateCustomerInput }
  | {
      readonly kind: 'createCheckoutSession';
      readonly input: CreateCheckoutSessionInput;
    }
  | {
      readonly kind: 'createPortalSession';
      readonly input: CreatePortalSessionInput;
    }
  | {
      readonly kind: 'cancelSubscription';
      readonly providerSubscriptionId: string;
      readonly atPeriodEnd: boolean;
    }
  | {
      readonly kind: 'getSubscription';
      readonly providerSubscriptionId: string;
    }
  | {
      readonly kind: 'listSubscriptions';
      readonly input: ListSubscriptionsInput;
    }
  | {
      readonly kind: 'listInvoices';
      readonly providerCustomerId: string;
      readonly input: ListInvoicesInput | undefined;
    };

export interface DevMemoryProvider extends BillingProvider {
  readonly name: 'dev-memory';
  readonly calls: readonly DevMemoryCall[];
  /** Queue an event so the next `verifyWebhook(...)` returns it. */
  queueEvent(event: BillingEvent): void;
  /** Drain the queued events; used internally by `verifyWebhook` and
   * exposed for tests that want to assert on the queue. */
  drainEvents(): readonly BillingEvent[];
  /** Reset call log + queued events between tests. */
  reset(): void;
}

export const createDevMemoryProvider = (): DevMemoryProvider => {
  const calls: DevMemoryCall[] = [];
  let queued: BillingEvent[] = [];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;

  return {
    name: 'dev-memory',
    get calls() {
      return calls;
    },
    queueEvent(event: BillingEvent) {
      queued.push(event);
    },
    drainEvents() {
      const events = queued;
      queued = [];
      return events;
    },
    reset() {
      calls.length = 0;
      queued = [];
      counter = 0;
    },
    async createCustomer(input) {
      calls.push({ kind: 'createCustomer', input });
      return { providerCustomerId: nextId('cus') };
    },
    async createCheckoutSession(input) {
      calls.push({ kind: 'createCheckoutSession', input });
      const sessionId = nextId('cs');
      return {
        url: `https://checkout.example.com/session/${sessionId}`,
        sessionId,
      };
    },
    async createPortalSession(input) {
      calls.push({ kind: 'createPortalSession', input });
      return { url: input.returnUrl };
    },
    async cancelSubscription(providerSubscriptionId, opts) {
      calls.push({
        kind: 'cancelSubscription',
        providerSubscriptionId,
        atPeriodEnd: opts.atPeriodEnd,
      });
    },
    async getSubscription(providerSubscriptionId) {
      calls.push({ kind: 'getSubscription', providerSubscriptionId });
      // Tests that need a real subscription back queue it via
      // `queueEvent({ kind: 'subscription.activated', subscription, ... })`
      // and read it from `drainEvents()` instead.
      const now = new Date();
      const inAMonth = new Date(now.getTime() + 30 * 86_400_000);
      return {
        providerSubscriptionId,
        providerCustomerId: 'cus-stub',
        providerPriceId: 'price-stub',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: inAMonth,
        cancelAt: null,
        canceledAt: null,
        trialEnd: null,
        metadata: {},
      };
    },
    listSubscriptions(input) {
      calls.push({ kind: 'listSubscriptions', input });
      // dev-memory yields nothing by default; the reconciliation test
      // wires a different provider to hand back specific rows. Returning
      // an explicit empty AsyncIterable avoids the require-yield rule on
      // an empty generator function.
      return (async function* () {})();
    },
    async listInvoices(providerCustomerId, input) {
      calls.push({ kind: 'listInvoices', providerCustomerId, input });
      return [];
    },
    verifyWebhook() {
      const events = queued;
      queued = [];
      return events;
    },
  };
};
