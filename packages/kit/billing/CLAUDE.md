# @kit/billing

Stripe-on-day-one billing subsystem with a thin `BillingProvider` port
shaped to fit Paddle / LemonSqueezy adapters later. Owns:

- a typed `billingService` API (`createCheckoutSession` / `createPortalSession`
  / `cancelSubscription` / `dispatchEvent`) consumed from routes and the
  webhook worker;
- the `billing_customers` / `plans` / `features` + `plan_features` /
  `prices` / `subscriptions` / `invoices` / `payment_methods` /
  `billing_webhook_events` tables (9 total), with idempotent `(provider,
  provider_event_id)` ledger ingestion mirroring `mail_events`;
- a Stripe adapter that lazy-loads the SDK (optional peer-dep) and
  normalizes provider events into our own `BillingEvent` union;
- an `entitlementsService.isFeatureEnabled(feature, tenant)` helper with
  Redis-cached resolution + a Fastify `requireFeature(key)` decorator;
- consumer-side BullMQ jobs for processing webhook events, nightly
  subscription reconciliation, weekly stuck-invoice sweep, and daily
  retention prune of the `billing_webhook_events` ledger.

## Directory

```
src/
  index.ts                        barrel
  schema.ts                       9 table interfaces + BillingDB
  config.ts                       billingConfigSchema (Zod fragment)
  errors.ts                       BillingError hierarchy
  events.ts                       BillingEvent union + type guards
  providers/
    types.ts                      BillingProvider interface + discriminated SendResult
    stripe.ts                     createStripeProvider -- lazy-loads `stripe`
    dev-memory.ts                 createDevMemoryProvider -- in-process for tests
    index.ts                      createBillingProvider(config) factory
  billing-customers-repository.ts  tenant-scoped reads + system-level upsert
  subscriptions-repository.ts      tenant-scoped reads + apply-event mutators
  invoices-repository.ts           tenant-scoped reads + findStuckOpen for reconcile
  payment-methods-repository.ts    tenant-scoped reads + apply-event + markDetached
  webhook-events-repository.ts     idempotent ledger (mirrors mail-events)
  plans-repository.ts              system-level: plans / prices / features / plan_features
  entitlements-service.ts          isFeatureEnabled with Redis cache
  billing-service.ts               createCheckoutSession / dispatchEvent / cancelSubscription
  provider.ts                      billingProvider() Awilix registration
  plugin.ts                        createBillingPlugin (decorates fastify.requireFeature)

migrations/
  20260520000001_create_billing_customers.ts
  20260520000002_create_plans.ts
  20260520000003_create_features_and_plan_features.ts
  20260520000004_create_prices.ts
  20260520000005_create_subscriptions.ts
  20260520000006_create_invoices_payment_methods_webhook_events.ts
```

## Key ideas

- **Outbox-style webhook ingestion.** `billing_webhook_events` is the
  idempotent ledger: `INSERT ... ON CONFLICT (provider,
  provider_event_id) DO NOTHING` absorbs Stripe's at-least-once retries.
  The receiver ACKs 200 immediately and enqueues `billing.process-event`
  with `jobId = 'billing-event:${provider}:${eventId}'` for second-layer
  dedup. Mirrors `mail_events` from `@kit/mailer` exactly.

- **Normalized `BillingEvent` union.** The Stripe adapter translates
  `Stripe.Event` into one of `subscription.activated/updated/canceled/
  trial-will-end | invoice.finalized/paid/payment-failed |
  payment-method.attached/updated/detached | checkout.completed |
  dispute.created`. Application code never imports `stripe` -- a future
  Paddle/LS adapter contributes its own translation layer and
  `billingService.dispatchEvent` does not change.

- **Tenant ↔ provider customer mapping in its own table.**
  `billing_customers(tenant_id, provider, provider_customer_id)` keeps
  `tenants` provider-agnostic. A future Paddle migration is a no-op on
  the core schema -- just a new row per tenant for the new provider.

- **Entitlements via `plan_features` join.**
  `plans -> plan_features(value jsonb) -> features` joined with the
  tenant's active subscription. `isFeatureEnabled(feature, tenant)` is
  cached in Redis under `entitlements:${tenantId}` with 5-min TTL,
  busted on every `subscription.activated/updated/canceled` event. The
  jsonb `value` column carries `{ enabled: boolean }` (boolean type),
  `{ limit: number }` (limit type), or `{ quotaPerMonth: number }`
  (quota type) -- the consumer enforces the actual limit/quota.

- **Reconciliation guards against missed webhooks.** Stripe retries
  webhook delivery for ~3 days. `billing.reconcile-subscriptions`
  (nightly, 03:00 UTC) walks every active/trialing/past_due subscription
  on the provider side and emits a synthetic event through the same
  `dispatchEvent` path -- the ledger absorbs no-ops via a
  `recon-sub:${subId}:${YYYYMMDD}` synthetic id.
  `billing.reconcile-invoices` (weekly, Sun 03:00 UTC) catches `'open'`
  invoices older than 7 days that may have missed their `invoice.paid`
  webhook.

- **`successUrl` / `cancelUrl` allowlist.** Inside
  `billingService.createCheckoutSession`, `successUrl` / `cancelUrl` /
  `returnUrl` are validated against `config.APP_URL`'s origin to
  prevent open-redirect through Stripe's redirect endpoints.

## Wiring (in services/api)

```ts
import {
  billingProvider,
  createBillingProvider,
  type EntitlementsCache,
} from '@kit/billing';
import { createBillingPlugin } from '@kit/billing/plugin';
import {
  createBillingCustomersRepository,
  createBillingWebhookEventsRepository,
  createInvoicesRepository,
  createPaymentMethodsRepository,
  createSubscriptionsRepository,
  createPlansRepository,
  createPricesRepository,
  createFeaturesRepository,
  createPlanFeaturesRepository,
} from '#modules/billing/...';

const billingProviderInstance = createBillingProvider(config);
const entitlementsCache: EntitlementsCache = {
  async get(key) { return await redis.get(key); },
  async set(key, value, ttl) { await redis.set(key, value, 'EX', ttl); },
  async delete(key) { await redis.del(key); },
};

const container = await createContainer({
  providers: [
    dbProvider(),
    authProvider({ /* see @kit/auth */ }),
    billingProvider({
      resolveBillingProvider: () => billingProviderInstance,
      resolveBillingCustomersRepository: ({ transaction, tenantContext }) =>
        createBillingCustomersRepository({ transaction, tenantContext }),
      resolveSubscriptionsRepository: ({ transaction, tenantContext }) =>
        createSubscriptionsRepository({ transaction, tenantContext }),
      resolveInvoicesRepository: ({ transaction, tenantContext }) =>
        createInvoicesRepository({ transaction, tenantContext }),
      resolvePaymentMethodsRepository: ({ transaction, tenantContext }) =>
        createPaymentMethodsRepository({ transaction, tenantContext }),
      resolvePlansRepository: ({ transaction }) => createPlansRepository({ transaction }),
      resolvePricesRepository: ({ transaction }) => createPricesRepository({ transaction }),
      resolveFeaturesRepository: ({ transaction }) => createFeaturesRepository({ transaction }),
      resolvePlanFeaturesRepository: ({ transaction }) =>
        createPlanFeaturesRepository({ transaction }),
      resolveWebhookEventsRepository: ({ transaction }) =>
        createBillingWebhookEventsRepository({ transaction }),
      resolveEntitlementsCache: () => entitlementsCache,
      resolveRedirectAllowlistOrigin: () => new URL(config.APP_URL).origin,
    }),
  ],
});
```

Register `createBillingPlugin` in the Fastify plugin chain (after
admin) so `fastify.requireFeature(key)` is available on routes.

## Adding a new plan / price

Provider-first (canonical): create the plan + price in the Stripe
dashboard, copy the `price_...` id, run a migration that inserts the
matching `plans` + `prices` rows. The reconcile job converges any drift
back to the provider's truth.

DB-first (rare): seed `plans` + `prices` via a migration, then mirror
to Stripe via the provider's API or dashboard. Use only for local dev.

## Adding a feature / entitlement

```ts
// migration: insert into features + plan_features
await db.insertInto('features').values({
  key: 'export-csv',
  name: 'CSV export',
  description: 'Download report data as CSV.',
  type: 'boolean',
}).execute();

await db.insertInto('plan_features').values({
  plan_id: proPlanId,
  feature_key: 'export-csv',
  value: { enabled: true },
}).execute();
```

Then on a route:

```ts
fastify.route({
  url: '/exports/csv',
  onRequest: [fastify.verifyUser, fastify.requireFeature('export-csv')],
  handler: ...,
});
```

The cache is busted automatically on the next subscription change. To
manually invalidate during ops: call
`entitlementsService.invalidate(tenantId)`.

## Adding a new provider

Implement `BillingProvider` from `providers/types.ts`:

```ts
export const createPaddleProvider = (opts: PaddleOptions): BillingProvider => ({
  name: 'paddle',
  async createCustomer(...) { ... },
  async createCheckoutSession(...) { ... },
  async createPortalSession(...) { ... },
  async cancelSubscription(...) { ... },
  async getSubscription(...) { ... },
  listSubscriptions(...) { /* AsyncIterable */ },
  async listInvoices(...) { ... },
  verifyWebhook(...) { /* return BillingEvent[] | null */ },
});
```

Wire it into `createBillingProvider(config)` (the kit's switch). Add
`paddle` to the `BILLING_PROVIDER` enum in `config.ts`. Adding the SDK
as an optional peer-dep keeps the install lean for consumers using a
different provider.

## Webhook setup

Stripe dashboard -> Developers -> Webhooks -> Add endpoint:

- **URL**: `https://api.example.com/webhooks/billing/stripe`
- **Events**: `checkout.session.completed`,
  `customer.subscription.{created,updated,deleted,trial_will_end}`,
  `invoice.{finalized,paid,payment_failed}`,
  `payment_method.{attached,detached,updated}`,
  `charge.dispute.created`.
- Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.

Local dev: `stripe listen --forward-to http://localhost:3000/webhooks/billing/stripe`.

## Reconciliation strategy

| Job | Cadence | Purpose |
| --- | --- | --- |
| `billing.process-event` | on-demand (BullMQ) | Process incoming webhook events from the ledger. Retries with exp backoff (30s base, 6 attempts). |
| `billing.reconcile-subscriptions` | nightly @ 03:00 UTC | Diff every active/trialing/past_due subscription against the provider; emit corrective events. |
| `billing.reconcile-invoices` | weekly Sun @ 03:00 UTC | Re-fetch any local `'open'` invoice > 7 days old. |
| `billing.prune` | daily @ 04:00 UTC | Delete `billing_webhook_events` rows older than 30 days. |

## Gotchas

- **Tenant frame inside workers.** Routes have a tenant frame from the
  `@kit/tenancy` plugin; jobs don't. The `billing.process-event` worker
  opens `tenantContext.withTenant(tenantId, ...)` before any
  tenant-scoped repository call (audit emission, mail send). Forgetting
  this would cause `TenantNotResolved`.
- **Card brand/last4 are PII-adjacent.** The `payment_methods.admin.ts`
  override declares `sensitiveColumns: ['brand', 'last4']`. The
  `audit_log` diff utility honours these and replaces the values with
  `[REDACTED]` in stored diffs.
- **Stripe "thin events" migration.** v1 reads `event.data.object` for
  state-non-critical fields. State-critical decisions (subscription
  status reconciliation, invoice paid timestamp) call
  `provider.getSubscription(...)` to re-fetch the canonical truth.
  When Stripe forces all consumers to thin events, swap the snapshot
  reads -- the `BillingEvent` normalization layer doesn't change.
- **Idempotency-key choice for checkout.** The kit uses
  `checkout:${tenantId}:${priceId}`. Two retries with the same key
  produce the same session URL (Stripe's idempotency). Don't include
  the timestamp -- that defeats the dedup.
- **No "subscription cancellation == provider cancel".** The
  `cancelSubscription` service call returns immediately; the local row
  is unchanged. The `customer.subscription.deleted` (or `.updated` with
  `cancel_at_period_end=true`) webhook arrives shortly after and lands
  the canonical state.
- **Allowlist enforcement for redirects.** Both the route layer and
  `billingService.createCheckoutSession` check the URL origin against
  `config.APP_URL`. The double-check is intentional -- checkout is the
  highest-leverage redirect surface in the kit.

## Conventions

- `subscriptions` / `invoices` / `payment_methods` are append-event-only
  on the happy path; the `apply*FromEvent` mutators are the only legal
  writers. Direct DB writes from routes are never correct -- the
  webhook is the source of truth.
- Webhook receivers ALWAYS ACK 200 (even on signature failure) to avoid
  leaking validity to attackers.
- Provider-specific quirks (Stripe's signing secret, Paddle's webhook
  HMAC, etc.) live inside the per-provider `verifyWebhook` so the
  receiver route stays provider-agnostic.
- Never call `provider.cancelSubscription(...)` directly from a route.
  Always go through `billingService.cancelSubscription(...)` so the
  audit + entitlements-cache-bust path is exercised.
