/**
 * Billing webhook receiver. Single endpoint for v1:
 *
 *   POST /webhooks/billing/stripe
 *
 * Public (no auth) but rate-limited and tenant-bypassed. Mirrors
 * `services/api/src/modules/mailer/webhooks.route.ts`:
 *
 * 1. Captures the raw body (HMAC verification needs the exact bytes
 *    Stripe signed -- JSON.parse mangles whitespace).
 * 2. Hands raw body + headers to `billingProvider.verifyWebhook(...)` --
 *    the Stripe adapter calls `stripe.webhooks.constructEvent` inside.
 * 3. On verification failure: returns 200 with empty body. Returning
 *    401 leaks signature validity to attackers; the provider ACKs 2xx
 *    so we drop nothing useful by returning 200 silently.
 * 4. On success: appends each `BillingEvent` to `billing_webhook_events`
 *    (idempotent via `(provider, provider_event_id) UNIQUE`), enqueues
 *    a `billing.process-event` job per row, ACKs 200.
 *
 * The actual subscription / invoice / payment_method updates run async
 * in `billing.process-event` so the receiver returns fast even when
 * Stripe is hammering during a deliverability incident.
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { BillingEvent, BillingProvider } from '@kit/billing';
import { withTenantBypass } from '@kit/tenancy';

interface WebhookCradle {
  billingProvider: BillingProvider;
  billingWebhookEventsRepository: {
    append(entry: {
      provider: string;
      provider_event_id: string;
      type: string;
      payload: Record<string, unknown>;
    }): Promise<{ id: string } | null>;
  };
  queues: {
    billing: {
      add(
        name: 'billing.process-event',
        data: { eventId: string },
        opts?: { jobId?: string },
      ): Promise<unknown>;
    };
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const WebhookEmptyResponse = Type.Null();

const webhookRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body: Buffer, done) => {
      request.rawBody = body;
      if (body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (error) {
        done(error as Error);
      }
    },
  );

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const cradle = fastify.diContainer.cradle as unknown as WebhookCradle;
    const provider = cradle.billingProvider;
    if (provider.name !== 'stripe') {
      // The webhook is registered for Stripe; if the active provider is
      // dev-memory (tests) or another adapter, silently 200.
      return reply.status(200).send(null);
    }
    const rawBody =
      request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    let events: readonly BillingEvent[];
    try {
      const result = provider.verifyWebhook({
        headers: request.headers as Record<
          string,
          string | string[] | undefined
        >,
        rawBody,
      });
      if (result === null) {
        // Signature failure -- 200 silent ACK, don't leak validity.
        return reply.status(200).send(null);
      }
      events = result;
    } catch {
      return reply.status(200).send(null);
    }

    const rawJson = parseRawJsonOrEmpty(rawBody);
    const providerEventId = extractEventId(rawJson);

    for (const event of events) {
      const eventId = providerEventId ?? `derived:${event.kind}:${Date.now()}`;
      const inserted = await cradle.billingWebhookEventsRepository.append({
        provider: provider.name,
        provider_event_id: eventId,
        type: event.kind,
        payload: rawJson,
      });
      if (inserted) {
        await cradle.queues.billing.add(
          'billing.process-event',
          { eventId: inserted.id },
          { jobId: `billing-event:${provider.name}:${eventId}` },
        );
      }
    }
    return reply.status(200).send(null);
  };

  fastify.route({
    method: 'POST',
    url: '/billing/stripe',
    ...withTenantBypass({ rateLimit: { max: 200, timeWindow: '1 minute' } }),
    schema: {
      tags: ['webhooks', 'billing'],
      response: { 200: WebhookEmptyResponse },
    },
    handler,
  });
};

const parseRawJsonOrEmpty = (raw: Buffer): Record<string, unknown> => {
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const extractEventId = (raw: Record<string, unknown>): string | null => {
  const id = raw['id'];
  return typeof id === 'string' ? id : null;
};

export default webhookRoutes;
export const autoPrefix = '/webhooks';
