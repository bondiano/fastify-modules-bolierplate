/**
 * Sweep job. Runs every 60s; finds rows stuck at `'queued'` for >2min
 * (typically because the originating process died between the outbox
 * insert and the BullMQ enqueue) and re-enqueues them. The
 * `mail_deliveries.idempotency_key UNIQUE` + BullMQ `jobId` deduping
 * means re-enqueue is safe even if the row was already in BullMQ.
 *
 * Capped at 100 rows per pass so a backlog doesn't starve the worker
 * pool. The sweep doesn't update status -- BullMQ does that via the
 * normal `mail.send` lifecycle once the row is back on the queue.
 */
import { createJob } from '@kit/jobs';

declare module '@kit/jobs' {
  interface Jobs {
    'mail.sweep': undefined;
  }
}

const SWEEP_AGE_MS = 120_000;
const SWEEP_LIMIT = 100;

interface MailSweepCradle {
  mailDeliveriesRepository: {
    findStaleQueued(opts: {
      olderThanMs: number;
      limit: number;
    }): Promise<readonly { id: string; idempotencyKey: string }[]>;
  };
  queues: {
    mail: {
      add(
        name: 'mail.send',
        data: { deliveryId: string },
        opts?: { jobId?: string },
      ): Promise<unknown>;
    };
  };
}

export default createJob(
  'mail.sweep',
  async (fastify) => {
    const cradle = fastify.diContainer.cradle as unknown as MailSweepCradle;
    const stale = await cradle.mailDeliveriesRepository.findStaleQueued({
      olderThanMs: SWEEP_AGE_MS,
      limit: SWEEP_LIMIT,
    });
    if (stale.length === 0) return;
    fastify.log.info(
      { count: stale.length },
      'mail.sweep: re-enqueueing stale deliveries',
    );
    for (const row of stale) {
      await cradle.queues.mail.add(
        'mail.send',
        { deliveryId: row.id },
        { jobId: row.idempotencyKey },
      );
    }
  },
  {
    repeat: { pattern: '* * * * *' },
    workerConfig: { concurrency: 1 },
  },
);
