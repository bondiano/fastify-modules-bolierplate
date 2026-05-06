/**
 * Kysely table interfaces for the canonical billing tables. Consumers
 * whose generated `DB` extends `BillingDB` (via interface merging in
 * `services/api/src/db/schema.ts`) get all the billing repositories +
 * services typed end-to-end.
 *
 * Design notes:
 *
 * - `billing_customers` maps `(tenant_id, provider)` -> provider's
 *   customer id. Living in its own table (rather than as a column on
 *   `tenants`) keeps the tenant schema provider-agnostic and makes a
 *   future Paddle/LS adapter a no-migration change.
 *
 * - `subscriptions` / `invoices` / `payment_methods` are tenant-scoped
 *   reads (admin lists, dashboard widgets) plus system-level apply-event
 *   mutators (the `billing.process-event` worker writes them after
 *   tenant frame is opened via `tenantContext.withTenant`).
 *
 * - `webhook_events` is the idempotent ledger -- `(provider,
 *   provider_event_id) UNIQUE` + `INSERT ... ON CONFLICT DO NOTHING`
 *   absorbs Stripe's at-least-once delivery. Mirrors `mail_events`
 *   exactly. 30-day retention via `billing.prune` cron.
 *
 * - `plans`, `prices`, `features`, `plan_features` are system-level
 *   (no tenant_id). Adding a feature to a plan is an ops action;
 *   per-tenant overrides land in a separate `tenant_feature_overrides`
 *   table later.
 */
import type { ColumnType, Generated } from 'kysely';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid';

export type InvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'uncollectible'
  | 'void';

export type PriceInterval = 'month' | 'year' | 'one_time';

export type FeatureType = 'boolean' | 'limit' | 'quota';

export interface BillingCustomersTable {
  id: Generated<string>;
  tenantId: string;
  provider: string;
  /** Provider-supplied customer id (e.g. `cus_...` for Stripe). UNIQUE
   * per `(provider, provider_customer_id)`. */
  providerCustomerId: string;
  /** Snapshot of the email used at create time. Refreshed on
   * `customer.updated` webhook. */
  email: string | null;
  metadata: ColumnType<
    Record<string, unknown>,
    Record<string, unknown> | undefined,
    Record<string, unknown>
  >;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
  deletedAt: ColumnType<Date | null, string | null | undefined, string | null>;
}

export interface PlansTable {
  id: Generated<string>;
  /** Stable URL-safe key (e.g. `'starter'`). */
  slug: string;
  name: string;
  description: string | null;
  isActive: Generated<boolean>;
  /** Free-form provider metadata (Stripe product metadata, etc). */
  metadata: ColumnType<
    Record<string, unknown>,
    Record<string, unknown> | undefined,
    Record<string, unknown>
  >;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface FeaturesTable {
  /** Feature key (PK). Used by `isFeatureEnabled('export-csv', tenant)`. */
  key: string;
  name: string;
  description: string | null;
  type: FeatureType;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface PlanFeaturesTable {
  planId: string;
  featureKey: string;
  /** Feature value. `{ enabled: true }` for boolean type, `{ limit: 10 }`
   * for limit type, `{ quotaPerMonth: 100000 }` for quota type. */
  value: ColumnType<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface PricesTable {
  id: Generated<string>;
  planId: string;
  /** Provider price id (e.g. `price_...` for Stripe). UNIQUE. */
  providerPriceId: string;
  /** ISO 4217 currency code (e.g. `'usd'`). Lowercase by convention. */
  currency: string;
  amountCents: number;
  interval: PriceInterval;
  isActive: Generated<boolean>;
  metadata: ColumnType<
    Record<string, unknown>,
    Record<string, unknown> | undefined,
    Record<string, unknown>
  >;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface SubscriptionsTable {
  id: Generated<string>;
  tenantId: string;
  billingCustomerId: string;
  /** Nullable: when a plan is deleted/migrated, existing subscriptions
   * keep working until the next provider event. */
  planId: string | null;
  /** Provider subscription id (e.g. `sub_...` for Stripe). UNIQUE. */
  providerSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodStart: ColumnType<Date, string, string>;
  currentPeriodEnd: ColumnType<Date, string, string>;
  cancelAt: ColumnType<Date | null, string | null | undefined, string | null>;
  canceledAt: ColumnType<Date | null, string | null | undefined, string | null>;
  trialEnd: ColumnType<Date | null, string | null | undefined, string | null>;
  metadata: ColumnType<
    Record<string, unknown>,
    Record<string, unknown> | undefined,
    Record<string, unknown>
  >;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface InvoicesTable {
  id: Generated<string>;
  tenantId: string;
  /** Nullable: one-off invoices not tied to a subscription (e.g.
   * a metered overage charge). */
  subscriptionId: string | null;
  billingCustomerId: string;
  providerInvoiceId: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  /** Stripe-hosted invoice page; suitable for "View invoice" CTAs. */
  hostedUrl: string | null;
  pdfUrl: string | null;
  issuedAt: ColumnType<Date, string, string>;
  paidAt: ColumnType<Date | null, string | null | undefined, string | null>;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface PaymentMethodsTable {
  id: Generated<string>;
  tenantId: string;
  billingCustomerId: string;
  providerPaymentMethodId: string;
  /** `'card'`, `'us_bank_account'`, etc. */
  type: string;
  /** Card-only fields. NULL for non-card methods. */
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: Generated<boolean>;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  deletedAt: ColumnType<Date | null, string | null | undefined, string | null>;
}

export interface BillingWebhookEventsTable {
  id: Generated<string>;
  provider: string;
  /** Provider-supplied unique event id (e.g. `evt_...` for Stripe).
   * UNIQUE per provider; ON CONFLICT DO NOTHING absorbs duplicates. */
  providerEventId: string;
  type: string;
  payload: ColumnType<
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
  receivedAt: ColumnType<Date, string | undefined, string | undefined>;
  processedAt: ColumnType<
    Date | null,
    string | null | undefined,
    string | null
  >;
  error: string | null;
}

/**
 * Minimum DB shape required by the billing repositories. A consumer's
 * generated `DB` type must extend this so `Trx<DB>` references the
 * correct column metadata.
 */
export interface BillingDB {
  billing_customers: BillingCustomersTable;
  plans: PlansTable;
  features: FeaturesTable;
  plan_features: PlanFeaturesTable;
  prices: PricesTable;
  subscriptions: SubscriptionsTable;
  invoices: InvoicesTable;
  payment_methods: PaymentMethodsTable;
  billing_webhook_events: BillingWebhookEventsTable;
}
