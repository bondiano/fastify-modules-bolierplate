/**
 * Domain errors for `@kit/billing`. Mirror the shape used by `@kit/mailer`
 * + `@kit/auth`: every class carries `statusCode` + `error` (name) so the
 * global Fastify error handler can map them to HTTP responses without
 * coupling this package to `@kit/errors`. Webhook receivers translate
 * verification failures into HTTP 200 + empty body deliberately to avoid
 * leaking validity to attackers.
 */
export class BillingError extends Error {
  public readonly statusCode: number;
  public readonly error: string;

  constructor(message: string, statusCode: number, error: string) {
    super(message);
    this.name = error;
    this.statusCode = statusCode;
    this.error = error;
  }
}

/** Thrown by `createBillingProvider(...)` when the configured provider's
 * SDK is missing or required env vars are unset. Surfaces a clear "set
 * STRIPE_SECRET_KEY" / "install stripe" hint at boot. */
export class BillingProviderNotConfigured extends BillingError {
  constructor(message: string) {
    super(message, 500, 'BillingProviderNotConfigured');
  }
}

/** Thrown when a tenant has no `billing_customers` row but a flow that
 * needs one (portal session, list invoices) is attempted. Indicates the
 * caller should run the create-customer step first. */
export class BillingCustomerMissing extends BillingError {
  public readonly tenantId: string;
  public readonly provider: string;
  constructor(tenantId: string, provider: string) {
    super(
      `No billing customer for tenant ${tenantId} and provider ${provider}.`,
      404,
      'BillingCustomerMissing',
    );
    this.tenantId = tenantId;
    this.provider = provider;
  }
}

/** Thrown by `entitlementsService.isFeatureEnabled` when an active
 * subscription is required but the tenant has no plan. Routes guarded
 * by `requireFeature(...)` translate this to 403. */
export class EntitlementCheckFailed extends BillingError {
  public readonly featureKey: string;
  public readonly tenantId: string;
  constructor(featureKey: string, tenantId: string) {
    super(
      `Feature "${featureKey}" is not enabled for tenant ${tenantId}.`,
      403,
      'EntitlementCheckFailed',
    );
    this.featureKey = featureKey;
    this.tenantId = tenantId;
  }
}

/** Thrown by webhook verifiers when the signature is invalid or the
 * payload is malformed. Webhook receivers translate to HTTP 200 + an
 * empty body to avoid leaking validity to attackers. */
export class BillingWebhookVerificationFailed extends BillingError {
  constructor(message = 'Webhook signature verification failed') {
    super(message, 401, 'BillingWebhookVerificationFailed');
  }
}

/** Thrown by `billingService.createCheckoutSession` when the requested
 * `successUrl` / `cancelUrl` doesn't match the configured allowlist
 * origin -- prevents open-redirect via Stripe's redirect endpoint. */
export class BillingRedirectUrlNotAllowed extends BillingError {
  public readonly url: string;
  constructor(url: string) {
    super(
      `Redirect URL "${url}" is not in the configured allowlist.`,
      400,
      'BillingRedirectUrlNotAllowed',
    );
    this.url = url;
  }
}

/** Returned (not thrown) by the `billing.process-event` worker when the
 * webhook event is malformed enough to skip without retry. The worker
 * marks the row's `error` column and moves on. */
export class BillingEventNormalizationFailed extends BillingError {
  public readonly providerEventId: string;
  constructor(providerEventId: string, message: string) {
    super(message, 422, 'BillingEventNormalizationFailed');
    this.providerEventId = providerEventId;
  }
}
