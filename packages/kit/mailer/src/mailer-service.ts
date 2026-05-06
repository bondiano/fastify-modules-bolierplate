/**
 * High-level mailer service. Two surfaces:
 *
 * 1. **Enqueue path** -- called from request handlers / event callbacks
 *    (`onPasswordResetRequested(event)` etc). Inserts a row into
 *    `mail_deliveries` (the outbox), then dispatches to BullMQ via the
 *    consumer-supplied `dispatchJob` callback.
 *
 * 2. **Dispatch path** -- called from the `mail.send` BullMQ worker.
 *    Renders the template (or uses raw HTML for `sendRaw` flows),
 *    resolves the per-tenant `from` (with fallback to platform), and
 *    calls the active transport. Returns a `SendResult` so the worker
 *    can branch on retryable/fatal.
 *
 * The split is deliberate: enqueue is synchronous + idempotent, dispatch
 * is async + side-effecty. Tests can drive each surface in isolation.
 */
import type {
  MailDeliveriesRepository,
  MailDeliveryRow,
} from './mail-deliveries-repository.js';
import type { KitMailMessage, MailMessage } from './templates/_helpers.js';
import { listRegisteredTemplates } from './templates/registry.js';
import { renderTemplate } from './templates/render.js';
import type { MailTransport, SendResult } from './transports/types.js';

export interface MailerServiceDeps {
  readonly mailDeliveriesRepository: MailDeliveriesRepository<never>;
  readonly transport: MailTransport;
  /** Default platform `from` -- used when no per-tenant override is
   * verified. Comes from `config.MAIL_FROM`. */
  readonly defaultFrom: string;
  readonly defaultFromName?: string;
  /** Hook invoked AFTER the outbox row is committed. Consumer wires
   * this to `(id) => fastify.queues.mail.add('mail.send', { deliveryId: id },
   * { jobId: idempotencyKey })`. Synchronous from the kit's
   * perspective -- if the BullMQ enqueue fails, the row stays at
   * 'queued' and the sweep job picks it up within 60s. */
  readonly dispatchJob: (
    deliveryId: string,
    idempotencyKey: string,
  ) => Promise<void>;
  /** Optional resolver for per-tenant `from` overrides. Returns `null`
   * when the tenant has no verified override; the service falls back
   * to `defaultFrom`. */
  readonly resolveTenantFrom?: (
    tenantId: string,
  ) => Promise<{ from: string; fromName?: string } | null>;
}

export interface SendOptions {
  readonly idempotencyKey: string;
  readonly to: string;
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly locale?: string;
  readonly correlationId?: string;
  readonly tags?: readonly string[];
  readonly scheduledFor?: Date;
}

export interface MailerService {
  send<K extends keyof MailTemplates>(
    template: K,
    payload: MailTemplates[K],
    opts: SendOptions,
  ): Promise<{ deliveryId: string }>;

  sendRaw(
    message: KitMailMessage,
    opts: SendOptions,
  ): Promise<{ deliveryId: string }>;

  /** Worker-side: render + send. Returns a `SendResult` so the worker
   * can apply retry/backoff / mark the row failed without throwing. */
  dispatch(delivery: MailDeliveryRow): Promise<SendResult>;

  /** Read-only debug/admin helper: list every registered template
   * by name + subject. Used by `/admin/mail/preview`. */
  listTemplates(): readonly { name: string; subject: string }[];
}

export const createMailerService = (deps: MailerServiceDeps): MailerService => {
  const {
    mailDeliveriesRepository,
    transport,
    defaultFrom,
    defaultFromName,
    dispatchJob,
    resolveTenantFrom,
  } = deps;

  const resolveFrom = async (
    tenantId: string | null,
  ): Promise<{ from: string; fromName?: string; replyTo?: string }> => {
    if (tenantId === null || !resolveTenantFrom) {
      return defaultFromName
        ? { from: defaultFrom, fromName: defaultFromName }
        : { from: defaultFrom };
    }
    const override = await resolveTenantFrom(tenantId);
    if (!override) {
      return defaultFromName
        ? { from: defaultFrom, fromName: defaultFromName }
        : { from: defaultFrom };
    }
    // Per the plan: when the tenant override is verified, use it as
    // the `from`. Until DKIM verification ships (Phase 3), fall back
    // to the platform `from` with `Reply-To` pointed at the tenant.
    return {
      from: override.from,
      ...(override.fromName ? { fromName: override.fromName } : {}),
    };
  };

  const enqueue = async (
    template: string,
    payload: Record<string, unknown>,
    opts: SendOptions,
    rendered: KitMailMessage,
  ): Promise<{ deliveryId: string }> => {
    const fromResolved = await resolveFrom(opts.tenantId);
    const enqueued = await mailDeliveriesRepository.enqueue({
      idempotencyKey: opts.idempotencyKey,
      tenantId: opts.tenantId,
      userId: opts.userId ?? null,
      template,
      ...(opts.locale ? { locale: opts.locale } : {}),
      toAddress: rendered.to,
      fromAddress: fromResolved.from,
      subject: rendered.subject,
      payload,
      ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
      ...(opts.tags ? { tags: opts.tags } : {}),
      ...(opts.scheduledFor ? { scheduledFor: opts.scheduledFor } : {}),
    });
    // Best-effort dispatch -- if BullMQ enqueue fails, the sweep job
    // re-tries on a 60s cadence. We rethrow so the originating
    // callback knows the dispatch was queued (or that the attempt
    // failed and an alert should fire).
    await dispatchJob(enqueued.id, enqueued.idempotencyKey);
    return { deliveryId: enqueued.id };
  };

  return {
    async send(template, payload, opts) {
      const rendered = await renderTemplate(template, {
        to: opts.to,
        payload,
        ...(opts.locale ? { locale: opts.locale as 'en' } : {}),
      });
      return enqueue(
        String(template),
        payload as unknown as Record<string, unknown>,
        opts,
        rendered,
      );
    },

    async sendRaw(message, opts) {
      // Raw payloads still go through the outbox so they get the same
      // idempotency / observability story as templated sends.
      return enqueue('_raw', { ...message }, opts, {
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },

    async dispatch(delivery) {
      // For raw sends we stored the rendered HTML/text in the payload
      // jsonb; otherwise we re-render from the template registry so a
      // template version bump propagates without re-enqueue.
      let message: MailMessage;
      const fromResolved = await resolveFrom(delivery.tenantId);
      if (delivery.template === '_raw') {
        const rawPayload = (delivery.payload ??
          {}) as unknown as KitMailMessage;
        message = {
          to: delivery.toAddress,
          subject: delivery.subject,
          text: rawPayload.text,
          html: rawPayload.html,
          from: fromResolved.from,
          ...(fromResolved.fromName ? { fromName: fromResolved.fromName } : {}),
          ...(delivery.replyTo ? { replyTo: delivery.replyTo } : {}),
          ...(delivery.tags && delivery.tags.length > 0
            ? { tags: delivery.tags }
            : {}),
        };
      } else {
        const rendered = await renderTemplate(
          delivery.template as keyof MailTemplates,
          {
            to: delivery.toAddress,
            payload: (delivery.payload ?? {}) as never,
            ...(delivery.locale ? { locale: delivery.locale as 'en' } : {}),
          },
        );
        message = {
          ...rendered,
          from: fromResolved.from,
          ...(fromResolved.fromName ? { fromName: fromResolved.fromName } : {}),
          ...(delivery.replyTo ? { replyTo: delivery.replyTo } : {}),
          ...(delivery.tags && delivery.tags.length > 0
            ? { tags: delivery.tags }
            : {}),
        };
      }

      await mailDeliveriesRepository.markSending(delivery.id, transport.name);
      return transport.send(message, {
        idempotencyKey: delivery.idempotencyKey,
      });
    },

    listTemplates() {
      return listRegisteredTemplates().map((entry) => ({
        name: String(entry.name),
        subject: entry.subject,
      }));
    },
  };
};
