/**
 * Mailer webhook receivers. Three sibling endpoints, one per provider:
 *
 *   POST /webhooks/mail/ses
 *   POST /webhooks/mail/postmark
 *   POST /webhooks/mail/resend
 *
 * Routes are public (no auth) but rate-limited and tenant-bypassed.
 * Each receiver:
 *
 * 1. Captures the raw body (needed for HMAC verification before JSON
 *    parse can mangle whitespace).
 * 2. Hands the raw body + headers to the active transport's
 *    `verifyWebhook(...)` -- the verifier handles per-provider
 *    signature shapes (SES SNS RSA, Resend Svix HMAC, Postmark Basic).
 * 3. On verification failure: returns 200 with empty body. Returning
 *    401/403 leaks signature validity to attackers; returning 200 with
 *    no events is harmless because the provider treats 2xx as ACK and
 *    we've persisted nothing.
 * 4. On success: appends each `MailEvent` to `mail_events` (idempotent
 *    via the `(provider, event_id)` UNIQUE constraint), enqueues a
 *    `mail.process-event` job per row, ACKs 200.
 *
 * The actual `mail_deliveries` updates + suppression-list inserts run
 * async in `mail.process-event` so the receiver returns fast even when
 * the provider is hammering us during a deliverability incident.
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { MailEvent, MailTransport } from '@kit/mailer';
import { withTenantBypass } from '@kit/tenancy';

interface WebhookCradle {
  mailTransport: MailTransport;
  mailEventsRepository: {
    append(entry: {
      provider: string;
      eventId: string;
      type: string;
      providerMessageId: string | null;
      raw: Record<string, unknown>;
      occurredAt: string;
    }): Promise<{ id: string } | null>;
  };
  queues: {
    mail: {
      add(
        name: 'mail.process-event',
        data: { eventId: string },
        opts?: { jobId?: string },
      ): Promise<unknown>;
    };
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Raw request body captured by the webhook route's content-type
     * parser. Available only in routes registered inside this plugin
     * scope. */
    rawBody?: Buffer;
  }
}

const WebhookEmptyResponse = Type.Null();

const webhookRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  // Local content-type parser captures the raw body (Buffer) before
  // JSON.parse so signature verifiers can read the exact bytes the
  // provider signed. Scoped to this plugin so other routes still
  // benefit from Fastify's default streaming parser.
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

  fastify.addContentTypeParser(
    'text/plain',
    { parseAs: 'buffer' },
    (request, body: Buffer, done) => {
      // SES SNS sends `Content-Type: text/plain; charset=UTF-8` for
      // SubscriptionConfirmation messages even though the payload is
      // JSON. We treat the raw bytes the same way -- store + parse.
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

  const handler =
    (provider: 'ses' | 'postmark' | 'resend') =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cradle = fastify.diContainer.cradle as unknown as WebhookCradle;
      const transport = cradle.mailTransport;
      // The active transport is whichever provider the service is
      // configured to send through. If a webhook arrives for a
      // different provider (e.g. you switched from SES to Resend last
      // week, but the SES SNS topic is still configured), the verifier
      // returns null and we drop the event silently with 200.
      if (transport.name !== provider) {
        // Mismatched provider -- silently 200 so the provider's retry
        // logic doesn't hammer us.
        return reply.status(200).send(null);
      }
      const rawBody =
        request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
      let events: readonly MailEvent[];
      try {
        const result = transport.verifyWebhook?.({
          headers: request.headers as Record<
            string,
            string | string[] | undefined
          >,
          rawBody,
        });
        if (result === null || result === undefined) {
          // Signature failure or unsupported -- 200 silent ACK.
          return reply.status(200).send(null);
        }
        events = result;
      } catch {
        return reply.status(200).send(null);
      }

      for (const event of events) {
        const inserted = await cradle.mailEventsRepository.append({
          provider,
          eventId: event.providerEventId,
          type: event.type,
          providerMessageId: event.providerMessageId,
          raw: parseRawJsonOrEmpty(rawBody),
          occurredAt: event.occurredAt.toISOString(),
        });
        if (inserted) {
          await cradle.queues.mail.add(
            'mail.process-event',
            { eventId: inserted.id },
            { jobId: `mail-event:${provider}:${event.providerEventId}` },
          );
        }
      }
      return reply.status(200).send(null);
    };

  for (const provider of ['ses', 'postmark', 'resend'] as const) {
    fastify.route({
      method: 'POST',
      url: `/mail/${provider}`,
      ...withTenantBypass({ rateLimit: { max: 100, timeWindow: '1 minute' } }),
      schema: {
        tags: ['webhooks', 'mail'],
        response: { 200: WebhookEmptyResponse },
      },
      handler: handler(provider),
    });
  }
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

export default webhookRoutes;
export const autoPrefix = '/webhooks';
