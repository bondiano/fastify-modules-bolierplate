/**
 * Daily prune of the `audit_log` table. Removes rows older than
 * `config.AUDIT_RETENTION_DAYS` (default 90). Runs at 03:00 UTC -- a
 * non-peak window for typical SaaS traffic. The repository's
 * `pruneOlderThan` is system-level (no tenant frame required), so the
 * job runs outside any `withTenant` scope.
 */
import type { AppConfig } from '#config.ts';
import { createJob } from '@kit/jobs';

declare module '@kit/jobs' {
  interface Jobs {
    'audit.prune': undefined;
  }
}

const MS_PER_DAY = 86_400_000;

interface AuditPruneRepository {
  pruneOlderThan: (cutoff: Date) => Promise<{ deleted: number }>;
}

interface AuditPruneCradle {
  auditLogRepository: AuditPruneRepository;
  config: AppConfig;
}

export default createJob(
  'audit.prune',
  async (fastify) => {
    const cradle = fastify.diContainer.cradle as unknown as AuditPruneCradle;
    const cutoff = new Date(
      Date.now() - cradle.config.AUDIT_RETENTION_DAYS * MS_PER_DAY,
    );
    const { deleted } = await cradle.auditLogRepository.pruneOlderThan(cutoff);
    fastify.log.info(
      { cutoff: cutoff.toISOString(), deleted },
      'audit.prune complete',
    );
  },
  { repeat: { pattern: '0 3 * * *' } },
);
