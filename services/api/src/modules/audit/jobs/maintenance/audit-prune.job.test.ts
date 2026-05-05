import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import auditPruneJob from './audit-prune.job.ts';

interface FakeLog {
  info: (...args: unknown[]) => void;
}

const silentLog: FakeLog = { info: () => {} };

const buildFastify = (
  pruneOlderThan: (cutoff: Date) => Promise<{ deleted: number }>,
  retentionDays: number,
  log: FakeLog,
) =>
  ({
    diContainer: {
      cradle: {
        auditLogRepository: { pruneOlderThan },
        config: { AUDIT_RETENTION_DAYS: retentionDays },
      },
    },
    log,
  }) as never;

describe('audit.prune job', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('declares a daily 03:00 UTC cron schedule', () => {
    expect(auditPruneJob.job.name).toBe('audit.prune');
    expect(auditPruneJob.job.repeat).toEqual({ pattern: '0 3 * * *' });
  });

  it('computes cutoff = now - retention_days and forwards to the repo', async () => {
    const pruneOlderThan = vi.fn().mockResolvedValue({ deleted: 17 });
    const log = { info: vi.fn() };

    await auditPruneJob.handler(buildFastify(pruneOlderThan, 90, log), {
      data: undefined,
    } as never);

    expect(pruneOlderThan).toHaveBeenCalledOnce();
    const cutoff = pruneOlderThan.mock.calls[0]![0] as Date;
    // 90 days before 2026-05-05T12:00:00Z = 2026-02-04T12:00:00Z
    expect(cutoff.toISOString()).toBe('2026-02-04T12:00:00.000Z');
    expect(log.info).toHaveBeenCalledOnce();
    const meta = log.info.mock.calls[0]![0] as { deleted: number };
    expect(meta.deleted).toBe(17);
  });

  it('honours an alternate retention value from config', async () => {
    const pruneOlderThan = vi.fn().mockResolvedValue({ deleted: 0 });

    await auditPruneJob.handler(buildFastify(pruneOlderThan, 7, silentLog), {
      data: undefined,
    } as never);
    const cutoff = pruneOlderThan.mock.calls[0]![0] as Date;
    expect(cutoff.toISOString()).toBe('2026-04-28T12:00:00.000Z');
  });
});
