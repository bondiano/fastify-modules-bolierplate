/**
 * Worker for the `mail.send` queue. The route handler / event callback
 * has already inserted the `mail_deliveries` row (via `mailerService.send`)
 * and enqueued this job. We pull the row by id, open a tenant frame
 * (when applicable), check the suppression list, dispatch via the
 * configured transport, and update status + audit.
 *
 * Retry policy lives on the queue itself (`queueConfig.defaultJobOptions`):
 * 6 attempts, exponential backoff starting at 30s. Fatal failures (4xx,
 * suppression hit) skip retry by marking the row `failed`/`suppressed`
 * and returning normally. Retryable failures throw so BullMQ schedules
 * the next attempt.
 */
import type { Queue } from 'bullmq';

import { createJob } from '@kit/jobs';

declare module '@kit/jobs' {
  interface Jobs {
    'mail.send': { deliveryId: string };
  }
  interface Queues {
    mail: Queue<Jobs['mail.send']>;
  }
}

interface MailDeliveryRecord {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly tenantId: string | null;
  readonly toAddress: string;
  readonly status: string;
}

interface MailSendCradle {
  mailDeliveriesRepository: {
    findByIdGlobally(id: string): Promise<MailDeliveryRecord | null>;
    markSent(id: string, providerMessageId: string): Promise<void>;
    markFailed(id: string, code: string, message: string): Promise<void>;
    markSuppressed(id: string): Promise<void>;
    recordAttempt(id: string, code: string, message: string): Promise<void>;
  };
  mailSuppressionsRepository: {
    isSuppressed(email: string, tenantId?: string | null): Promise<boolean>;
  };
  mailerService: {
    dispatch(
      delivery: MailDeliveryRecord,
    ): Promise<
      | { ok: true; providerMessageId: string }
      | { ok: false; retryable: boolean; code: string; message: string }
    >;
  };
  auditLogRepository: {
    append(entry: {
      tenantId: string | null;
      actorId: null;
      subjectType: 'MailDelivery';
      subjectId: string;
      action: string;
      diff?: null;
      metadata?: Record<string, unknown> | null;
      ip?: null;
      userAgent?: null;
      correlationId?: string | null;
      sensitive?: boolean;
    }): Promise<unknown>;
  };
  tenantContext: {
    withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
  };
}

export default createJob<{ deliveryId: string }>(
  'mail.send',
  async (fastify, job) => {
    const cradle = fastify.diContainer.cradle as unknown as MailSendCradle;
    const {
      mailDeliveriesRepository,
      mailSuppressionsRepository,
      mailerService,
      auditLogRepository,
      tenantContext,
    } = cradle;
    const delivery = await mailDeliveriesRepository.findByIdGlobally(
      job.data.deliveryId,
    );
    if (!delivery) {
      fastify.log.warn(
        { deliveryId: job.data.deliveryId },
        'mail.send: delivery row missing -- swept or hard-deleted',
      );
      return;
    }
    if (delivery.status !== 'queued' && delivery.status !== 'sending') {
      // Idempotent re-run: another worker already processed this row.
      // Common after a sweep re-enqueue for a row that landed mid-flight.
      return;
    }

    // Open a tenant frame when the delivery has one so the suppression
    // lookup + audit emission see the right tenant. Pre-tenant flows
    // (signup confirmation, password reset request) skip the frame.
    const run: <T>(fn: () => Promise<T>) => Promise<T> =
      delivery.tenantId === null
        ? (fn) => fn()
        : (fn) => tenantContext.withTenant(delivery.tenantId!, fn);

    await run(async () => {
      const suppressed = await mailSuppressionsRepository.isSuppressed(
        delivery.toAddress,
        delivery.tenantId,
      );
      if (suppressed) {
        await mailDeliveriesRepository.markSuppressed(delivery.id);
        await auditLogRepository.append({
          tenantId: delivery.tenantId,
          actorId: null,
          subjectType: 'MailDelivery',
          subjectId: delivery.id,
          action: 'mail.suppressed',
          metadata: { email: delivery.toAddress },
          sensitive: false,
        });
        return;
      }

      const result = await mailerService.dispatch(delivery);
      if (result.ok) {
        await mailDeliveriesRepository.markSent(
          delivery.id,
          result.providerMessageId,
        );
        await auditLogRepository.append({
          tenantId: delivery.tenantId,
          actorId: null,
          subjectType: 'MailDelivery',
          subjectId: delivery.id,
          action: 'mail.sent',
          metadata: { providerMessageId: result.providerMessageId },
          sensitive: false,
        });
        return;
      }
      if (result.retryable) {
        await mailDeliveriesRepository.recordAttempt(
          delivery.id,
          result.code,
          result.message,
        );
        // Throw so BullMQ applies the queue's exponential backoff and
        // re-runs us. After `attempts` is reached the queue moves the
        // job to the failed set; the row stays at 'sending' status
        // until we explicitly mark it failed (the sweep job picks
        // these up on its next pass and marks them failed if they
        // genuinely exceeded attempts).
        throw new Error(
          `Retryable mail send failure (${result.code}): ${result.message}`,
        );
      }
      await mailDeliveriesRepository.markFailed(
        delivery.id,
        result.code,
        result.message,
      );
      await auditLogRepository.append({
        tenantId: delivery.tenantId,
        actorId: null,
        subjectType: 'MailDelivery',
        subjectId: delivery.id,
        action: 'mail.failed',
        metadata: { code: result.code, message: result.message },
        sensitive: false,
      });
    });
  },
  {
    workerConfig: { concurrency: 4 },
    queueConfig: {
      defaultJobOptions: {
        attempts: 6,
        backoff: { type: 'exponential', delay: 30_000 },
        // Keep success rows for 24h so an admin can correlate audit
        // -> BullMQ id during incident review. Failed rows live a week
        // -- enough to investigate before retention sweeps clean
        // them.
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 7 * 86_400 },
      },
    },
  },
);
