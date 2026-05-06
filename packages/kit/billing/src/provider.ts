/**
 * Awilix DI registration for `@kit/billing`. Mirrors the resolver-callback
 * pattern from `@kit/mailer`'s `mailerProvider`: every infrastructure
 * dependency comes through a callback so this package stays decoupled
 * from the consumer's `transaction` / `tenantContext` / `redis` shape.
 *
 * After `billingProvider({...})(container)` runs, the cradle exposes:
 *   - `billingProvider`
 *   - `billingCustomersRepository`
 *   - `subscriptionsRepository`
 *   - `invoicesRepository`
 *   - `paymentMethodsRepository`
 *   - `plansRepository`
 *   - `pricesRepository`
 *   - `featuresRepository`
 *   - `planFeaturesRepository`
 *   - `billingWebhookEventsRepository`
 *   - `entitlementsService`
 *   - `billingService`
 */
import { asFunction, Lifetime } from 'awilix';

import type { ContainerProvider } from '@kit/core/di';

import type { BillingCustomersRepository } from './billing-customers-repository.js';
import {
  createBillingService,
  type BillingService,
} from './billing-service.js';
import {
  createEntitlementsService,
  type EntitlementsCache,
  type EntitlementsService,
} from './entitlements-service.js';
import type { InvoicesRepository } from './invoices-repository.js';
import type { PaymentMethodsRepository } from './payment-methods-repository.js';
import type {
  FeaturesRepository,
  PlanFeaturesRepository,
  PlansRepository,
  PricesRepository,
} from './plans-repository.js';
import type { BillingProvider } from './providers/types.js';
import type { BillingDB } from './schema.js';
import type { SubscriptionsRepository } from './subscriptions-repository.js';
import type { BillingWebhookEventsRepository } from './webhook-events-repository.js';

declare global {
  interface Dependencies {
    billingProvider: BillingProvider;
    billingCustomersRepository: BillingCustomersRepository<BillingDB>;
    subscriptionsRepository: SubscriptionsRepository<BillingDB>;
    invoicesRepository: InvoicesRepository<BillingDB>;
    paymentMethodsRepository: PaymentMethodsRepository<BillingDB>;
    plansRepository: PlansRepository;
    pricesRepository: PricesRepository;
    featuresRepository: FeaturesRepository;
    planFeaturesRepository: PlanFeaturesRepository;
    billingWebhookEventsRepository: BillingWebhookEventsRepository;
    entitlementsService: EntitlementsService;
    billingService: BillingService;
  }
}

export interface BillingProviderOptions {
  resolveBillingProvider: (deps: Dependencies) => BillingProvider;
  resolveBillingCustomersRepository: (
    deps: Dependencies,
  ) => BillingCustomersRepository<BillingDB>;
  resolveSubscriptionsRepository: (
    deps: Dependencies,
  ) => SubscriptionsRepository<BillingDB>;
  resolveInvoicesRepository: (
    deps: Dependencies,
  ) => InvoicesRepository<BillingDB>;
  resolvePaymentMethodsRepository: (
    deps: Dependencies,
  ) => PaymentMethodsRepository<BillingDB>;
  resolvePlansRepository: (deps: Dependencies) => PlansRepository;
  resolvePricesRepository: (deps: Dependencies) => PricesRepository;
  resolveFeaturesRepository: (deps: Dependencies) => FeaturesRepository;
  resolvePlanFeaturesRepository: (deps: Dependencies) => PlanFeaturesRepository;
  resolveWebhookEventsRepository: (
    deps: Dependencies,
  ) => BillingWebhookEventsRepository;
  resolveEntitlementsCache: (deps: Dependencies) => EntitlementsCache;
  resolveRedirectAllowlistOrigin: (deps: Dependencies) => string;
}

export const billingProvider =
  (options: BillingProviderOptions): ContainerProvider =>
  (container) => {
    container.register({
      billingProvider: asFunction(options.resolveBillingProvider, {
        lifetime: Lifetime.SINGLETON,
      }),
      billingCustomersRepository: asFunction(
        options.resolveBillingCustomersRepository,
        { lifetime: Lifetime.SINGLETON },
      ),
      subscriptionsRepository: asFunction(
        options.resolveSubscriptionsRepository,
        { lifetime: Lifetime.SINGLETON },
      ),
      invoicesRepository: asFunction(options.resolveInvoicesRepository, {
        lifetime: Lifetime.SINGLETON,
      }),
      paymentMethodsRepository: asFunction(
        options.resolvePaymentMethodsRepository,
        { lifetime: Lifetime.SINGLETON },
      ),
      plansRepository: asFunction(options.resolvePlansRepository, {
        lifetime: Lifetime.SINGLETON,
      }),
      pricesRepository: asFunction(options.resolvePricesRepository, {
        lifetime: Lifetime.SINGLETON,
      }),
      featuresRepository: asFunction(options.resolveFeaturesRepository, {
        lifetime: Lifetime.SINGLETON,
      }),
      planFeaturesRepository: asFunction(
        options.resolvePlanFeaturesRepository,
        { lifetime: Lifetime.SINGLETON },
      ),
      billingWebhookEventsRepository: asFunction(
        options.resolveWebhookEventsRepository,
        { lifetime: Lifetime.SINGLETON },
      ),
      entitlementsService: asFunction(
        (deps: Dependencies) =>
          createEntitlementsService({
            subscriptionsRepository: deps.subscriptionsRepository,
            planFeaturesRepository: deps.planFeaturesRepository,
            cache: options.resolveEntitlementsCache(deps),
          }),
        { lifetime: Lifetime.SINGLETON },
      ),
      billingService: asFunction(
        (deps: Dependencies) =>
          createBillingService({
            provider: deps.billingProvider,
            billingCustomersRepository: deps.billingCustomersRepository,
            subscriptionsRepository: deps.subscriptionsRepository,
            invoicesRepository: deps.invoicesRepository,
            paymentMethodsRepository: deps.paymentMethodsRepository,
            plansRepository: deps.plansRepository,
            pricesRepository: deps.pricesRepository,
            entitlementsService: deps.entitlementsService,
            redirectAllowlistOrigin:
              options.resolveRedirectAllowlistOrigin(deps),
          }),
        { lifetime: Lifetime.SINGLETON },
      ),
    });
  };
