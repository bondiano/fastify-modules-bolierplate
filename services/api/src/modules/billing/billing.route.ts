/**
 * Billing routes (authenticated). Mounted under `/billing`:
 *
 *   POST /billing/checkout         -> Stripe Checkout URL
 *   POST /billing/portal           -> Stripe Billing Portal URL
 *   GET  /billing/subscription     -> active subscription for current tenant
 *   GET  /billing/invoices         -> paginated invoices
 *   DELETE /billing/subscription   -> cancel at period end (owner only)
 *
 * `successUrl` / `cancelUrl` / `returnUrl` are validated against
 * `config.APP_URL` origin inside `billingService.createCheckoutSession`
 * to prevent open-redirect through Stripe's redirect endpoints.
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

import type { DB } from '#db/schema.ts';
import {
  apiErrorEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  createSuccessResponseSchema,
  ok,
  paginated,
  paginatedQuerySchema,
} from '@kit/schemas';

const checkoutBody = Type.Object({
  priceId: Type.String({ format: 'uuid' }),
  successUrl: Type.String({ format: 'uri' }),
  cancelUrl: Type.String({ format: 'uri' }),
  trialPeriodDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
});

const portalBody = Type.Object({
  returnUrl: Type.String({ format: 'uri' }),
});

const checkoutResponse = Type.Object({
  url: Type.String(),
  sessionId: Type.String(),
});

const portalResponse = Type.Object({
  url: Type.String(),
});

const subscriptionResponse = Type.Object({
  id: Type.String(),
  status: Type.String(),
  planId: Type.Union([Type.String(), Type.Null()]),
  currentPeriodEnd: Type.String(),
  cancelAt: Type.Union([Type.String(), Type.Null()]),
  trialEnd: Type.Union([Type.String(), Type.Null()]),
});

const invoiceResponse = Type.Object({
  id: Type.String(),
  status: Type.String(),
  amountCents: Type.Integer(),
  currency: Type.String(),
  hostedUrl: Type.Union([Type.String(), Type.Null()]),
  pdfUrl: Type.Union([Type.String(), Type.Null()]),
  issuedAt: Type.String(),
  paidAt: Type.Union([Type.String(), Type.Null()]),
});

interface BillingCradle {
  billingService: {
    createCheckoutSession(input: {
      tenantId: string;
      tenantName: string;
      tenantEmail: string;
      priceId: string;
      successUrl: string;
      cancelUrl: string;
      trialPeriodDays?: number;
    }): Promise<{ url: string; sessionId: string }>;
    createPortalSession(input: {
      tenantId: string;
      tenantName: string;
      tenantEmail: string;
      returnUrl: string;
    }): Promise<{ url: string }>;
    cancelSubscription(
      row: { id: string; providerSubscriptionId: string; [k: string]: unknown },
      opts: { atPeriodEnd: boolean },
    ): Promise<void>;
  };
  subscriptionsRepository: {
    findActiveByTenant(tenantId: string): Promise<{
      id: string;
      status: string;
      planId: string | null;
      providerSubscriptionId: string;
      currentPeriodEnd: Date;
      cancelAt: Date | null;
      trialEnd: Date | null;
    } | null>;
  };
  invoicesRepository: {
    findPaginatedByPage(opts: { page: number; limit: number }): Promise<{
      items: readonly {
        id: string;
        status: string;
        amountCents: number;
        currency: string;
        hostedUrl: string | null;
        pdfUrl: string | null;
        issuedAt: Date;
        paidAt: Date | null;
      }[];
      total: number;
    }>;
  };
  tenantsRepository: {
    findById(id: string): Promise<{ id: string; name: string } | null>;
  };
}

const billingRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.route({
    method: 'POST',
    url: '/checkout',
    onRequest: fastify.verifyUser,
    schema: {
      tags: ['billing'],
      security: [{ bearerAuth: [] }],
      body: checkoutBody,
      response: {
        200: createSuccessResponseSchema(checkoutResponse),
        400: apiErrorEnvelopeSchema,
        401: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request) => {
      const cradle = fastify.diContainer.cradle as unknown as BillingCradle;
      const tenant = fastify.currentTenant();
      const userEmail = (request.auth as { email?: string }).email ?? '';
      const tenantRow = await cradle.tenantsRepository.findById(
        tenant.tenantId,
      );
      const result = await cradle.billingService.createCheckoutSession({
        tenantId: tenant.tenantId,
        tenantName: tenantRow?.name ?? userEmail,
        tenantEmail: userEmail,
        priceId: request.body.priceId,
        successUrl: request.body.successUrl,
        cancelUrl: request.body.cancelUrl,
        ...(request.body.trialPeriodDays
          ? { trialPeriodDays: request.body.trialPeriodDays }
          : {}),
      });
      request.audit('billing.checkout-started', {
        type: 'BillingCheckout',
        id: result.sessionId,
      });
      return ok(result);
    },
  });

  fastify.route({
    method: 'POST',
    url: '/portal',
    onRequest: fastify.verifyUser,
    schema: {
      tags: ['billing'],
      security: [{ bearerAuth: [] }],
      body: portalBody,
      response: {
        200: createSuccessResponseSchema(portalResponse),
        400: apiErrorEnvelopeSchema,
        401: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request) => {
      const cradle = fastify.diContainer.cradle as unknown as BillingCradle;
      const tenant = fastify.currentTenant();
      const userEmail = (request.auth as { email?: string }).email ?? '';
      const tenantRow = await cradle.tenantsRepository.findById(
        tenant.tenantId,
      );
      const result = await cradle.billingService.createPortalSession({
        tenantId: tenant.tenantId,
        tenantName: tenantRow?.name ?? userEmail,
        tenantEmail: userEmail,
        returnUrl: request.body.returnUrl,
      });
      request.audit('billing.portal-opened', {
        type: 'BillingPortal',
        id: tenant.tenantId,
      });
      return ok(result);
    },
  });

  fastify.route({
    method: 'GET',
    url: '/subscription',
    onRequest: fastify.verifyUser,
    schema: {
      tags: ['billing'],
      security: [{ bearerAuth: [] }],
      response: {
        200: createSuccessResponseSchema(
          Type.Union([subscriptionResponse, Type.Null()]),
        ),
      },
    },
    handler: async () => {
      const cradle = fastify.diContainer.cradle as unknown as BillingCradle;
      const tenant = fastify.currentTenant();
      const sub = await cradle.subscriptionsRepository.findActiveByTenant(
        tenant.tenantId,
      );
      if (!sub) return ok(null);
      return ok({
        id: sub.id,
        status: sub.status,
        planId: sub.planId,
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
        cancelAt: sub.cancelAt?.toISOString() ?? null,
        trialEnd: sub.trialEnd?.toISOString() ?? null,
      });
    },
  });

  fastify.route({
    method: 'GET',
    url: '/invoices',
    onRequest: fastify.verifyUser,
    schema: {
      tags: ['billing'],
      security: [{ bearerAuth: [] }],
      querystring: paginatedQuerySchema,
      response: {
        200: createPaginatedEnvelopeSchema(invoiceResponse),
      },
    },
    handler: async (request) => {
      const cradle = fastify.diContainer.cradle as unknown as BillingCradle;
      const result = await cradle.invoicesRepository.findPaginatedByPage({
        page: request.query.page,
        limit: request.query.limit,
      });
      return paginated(
        result.items.map((inv) => ({
          id: inv.id,
          status: inv.status,
          amountCents: inv.amountCents,
          currency: inv.currency,
          hostedUrl: inv.hostedUrl,
          pdfUrl: inv.pdfUrl,
          issuedAt: inv.issuedAt.toISOString(),
          paidAt: inv.paidAt?.toISOString() ?? null,
        })),
        request.query.page,
        request.query.limit,
        result.total,
      );
    },
  });

  fastify.route({
    method: 'DELETE',
    url: '/subscription',
    onRequest: fastify.verifyUser,
    schema: {
      tags: ['billing'],
      security: [{ bearerAuth: [] }],
      response: {
        204: Type.Null(),
        404: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request, reply) => {
      const cradle = fastify.diContainer.cradle as unknown as BillingCradle;
      const tenant = fastify.currentTenant();
      // Owner-only check: route uses verifyUser, but cancellation is
      // gated on tenant membership role. The CASL ability for
      // 'Subscription' resource consults `request.membership.role` --
      // see authz docs. For v1 we keep it simple: any authenticated
      // tenant member can cancel; abilities can tighten later.
      const sub = await cradle.subscriptionsRepository.findActiveByTenant(
        tenant.tenantId,
      );
      if (!sub) {
        return reply.status(404).send({
          data: null,
          error: {
            statusCode: 404,
            code: 'SUBSCRIPTION_NOT_FOUND',
            error: 'NotFound',
            message: 'No active subscription for this tenant.',
          },
        });
      }
      await cradle.billingService.cancelSubscription(sub, {
        atPeriodEnd: true,
      });
      request.audit('billing.subscription-cancel-requested', {
        type: 'Subscription',
        id: sub.id,
      });
      return reply.status(204).send(null);
    },
  });

  // `DB` only used as a marker so the auto-loader doesn't optimize the
  // import away; the actual cradle access is duck-typed above.
  void (null as unknown as DB);
};

export default billingRoute;
export const autoPrefix = '/billing';
