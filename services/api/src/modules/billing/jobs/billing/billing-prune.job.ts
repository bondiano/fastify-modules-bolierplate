/**
 * Daily prune of `billing_webhook_events` rows older than 30 days.
 * Stripe retries for ~3 days, so 30d retention covers debugging windows
 * with comfort margin. Mirrors `audit.prune` from `@kit/audit`.
 *
 * Scheduled at 04:00 UTC daily.
 */
import type { BillingWebhookEventsRepository } from '@kit/billing';
import { createJob } from '@kit/jobs';

declare module '@kit/jobs' {
  interface Jobs {
    'billing.prune': undefined;
  }
}

interface PruneCradle {
  billingWebhookEventsRepository: BillingWebhookEventsRepository;
  logger: { info(argument: Record<string, unknown>, message: string): void };
}

const THIRTY_DAYS_MS = 30 * 86_400_000;

export default createJob<undefined>(
  'billing.prune',
  async (fastify) => {
    const cradle = fastify.diContainer.cradle as unknown as PruneCradle;
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    const deleted =
      await cradle.billingWebhookEventsRepository.pruneOlderThan(cutoff);
    cradle.logger.info(
      { deleted, cutoff: cutoff.toISOString() },
      'billing.prune complete',
    );
  },
  {
    workerConfig: { concurrency: 1 },
    repeat: { pattern: '0 4 * * *' },
  },
);
