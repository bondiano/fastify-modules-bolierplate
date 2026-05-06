/**
 * Webhook event processor. The webhook receiver routes (`webhooks.route.ts`)
 * persisted the raw event in `mail_events` and ACKed 200 immediately.
 * This job runs async, normalises the event via the active transport's
 * `verifyWebhook(...)` helper (called for the same payload, this time
 * to extract the `MailEvent[]`), and:
 *
 * 1. Updates `mail_deliveries.status` + the matching timestamp column
 *    via `mailDeliveriesRepository.applyEvent({ providerMessageId, type, ... })`.
 * 2. For hard bounces / complaints, inserts a `mail_suppressions` row
 *    (or updates the existing one) so future sends skip the recipient.
 * 3. Marks the event row processed.
 * 4. Emits an audit row tying the event to the delivery.
 */
import { createJob } from '@kit/jobs';

declare module '@kit/jobs' {
  interface Jobs {
    'mail.process-event': { eventId: string };
  }
}

interface MailEventRow {
  readonly id: string;
  readonly provider: string;
  readonly eventId: string;
  readonly providerMessageId: string | null;
  readonly raw: Record<string, unknown>;
  readonly type: string;
  readonly occurredAt: Date;
  readonly processedAt: Date | null;
}

interface MailDeliveryRow {
  readonly id: string;
  readonly tenantId: string | null;
  readonly toAddress: string;
}

interface ProcessEventCradle {
  mailEventsRepository: {
    findById(id: string): Promise<MailEventRow | null>;
    markProcessed(id: string): Promise<void>;
  };
  mailDeliveriesRepository: {
    applyEvent(input: {
      providerMessageId: string;
      type:
        | 'delivered'
        | 'bounced.hard'
        | 'bounced.soft'
        | 'complained'
        | 'opened'
        | 'clicked';
      occurredAt: Date;
      reason?: string;
    }): Promise<MailDeliveryRow | null>;
  };
  mailSuppressionsRepository: {
    add(input: {
      tenantId: string | null;
      email: string;
      reason: 'hard_bounce' | 'complaint';
      source: string;
    }): Promise<unknown>;
  };
  auditLogRepository: {
    append(entry: {
      tenantId: string | null;
      actorId: null;
      subjectType: 'MailDelivery';
      subjectId: string;
      action: string;
      metadata?: Record<string, unknown>;
      sensitive?: boolean;
    }): Promise<unknown>;
  };
  tenantContext: {
    withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
  };
}

const ACTION_BY_TYPE: Readonly<
  Record<
    string,
    | 'mail.delivered'
    | 'mail.bounced'
    | 'mail.complained'
    | 'mail.opened'
    | 'mail.clicked'
  >
> = {
  delivered: 'mail.delivered',
  'bounced.hard': 'mail.bounced',
  'bounced.soft': 'mail.bounced',
  complained: 'mail.complained',
  opened: 'mail.opened',
  clicked: 'mail.clicked',
};

export default createJob<{ eventId: string }>(
  'mail.process-event',
  async (fastify, job) => {
    const cradle = fastify.diContainer.cradle as unknown as ProcessEventCradle;
    const event = await cradle.mailEventsRepository.findById(job.data.eventId);
    if (!event || event.processedAt !== null) {
      // Already processed (idempotent re-run after a worker restart) or
      // the row was sweep-cleaned -- nothing to do.
      return;
    }
    if (!event.providerMessageId) {
      // Provider sent us an event we can't tie back to a delivery
      // (rare; usually means the delivery row was deleted before the
      // event arrived). Mark processed so we don't retry forever.
      await cradle.mailEventsRepository.markProcessed(event.id);
      return;
    }

    const eventType = event.type;
    const reason = readReason(event.raw);
    const delivery = await cradle.mailDeliveriesRepository.applyEvent({
      providerMessageId: event.providerMessageId,
      type: eventType as
        | 'delivered'
        | 'bounced.hard'
        | 'bounced.soft'
        | 'complained'
        | 'opened'
        | 'clicked',
      occurredAt: event.occurredAt,
      ...(reason ? { reason } : {}),
    });

    if (
      delivery &&
      (eventType === 'bounced.hard' || eventType === 'complained')
    ) {
      const tenantId = delivery.tenantId;
      const reasonTag: 'hard_bounce' | 'complaint' =
        eventType === 'bounced.hard' ? 'hard_bounce' : 'complaint';
      const run: <T>(fn: () => Promise<T>) => Promise<T> =
        tenantId === null
          ? (fn) => fn()
          : (fn) => cradle.tenantContext.withTenant(tenantId, fn);
      await run(async () => {
        await cradle.mailSuppressionsRepository.add({
          tenantId,
          email: delivery.toAddress,
          reason: reasonTag,
          source: `webhook:${event.provider}`,
        });
      });
    }

    if (delivery) {
      const action = ACTION_BY_TYPE[eventType] ?? 'mail.event';
      await cradle.auditLogRepository.append({
        tenantId: delivery.tenantId,
        actorId: null,
        subjectType: 'MailDelivery',
        subjectId: delivery.id,
        action,
        metadata: {
          provider: event.provider,
          providerEventId: event.eventId,
          ...(reason ? { reason } : {}),
        },
        sensitive: false,
      });
    }
    await cradle.mailEventsRepository.markProcessed(event.id);
  },
  {
    workerConfig: { concurrency: 4 },
    queueConfig: {
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 7 * 86_400 },
      },
    },
  },
);

const readReason = (raw: Record<string, unknown>): string | undefined => {
  // Best-effort extraction across providers. Resend stores the bounce
  // subType under `data.bounce.subType`; SES under
  // `bounce.bouncedRecipients[0].diagnosticCode`; Postmark under
  // `Description`. Fall back to undefined when nothing matches.
  const data = (raw as { data?: { bounce?: { subType?: string } } }).data;
  if (data?.bounce?.subType) return data.bounce.subType;
  const sesBounce = (
    raw as {
      bounce?: { bouncedRecipients?: { diagnosticCode?: string }[] };
    }
  ).bounce;
  if (sesBounce?.bouncedRecipients?.[0]?.diagnosticCode) {
    return sesBounce.bouncedRecipients[0].diagnosticCode;
  }
  const description = (raw as { Description?: string }).Description;
  if (description) return description;
  return undefined;
};
