import { describe, expect, it } from 'vitest';

import { createJob } from './create-job.js';

const handler = async () => {};

describe('createJob', () => {
  it('returns a frozen config with name and handler', () => {
    const result = createJob('test-job', handler);

    expect(result.job.name).toBe('test-job');
    expect(result.handler).toBe(handler);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.job)).toBe(true);
  });

  it('includes optional queue and worker config', () => {
    const result = createJob('configured-job', async () => {}, {
      queueConfig: { defaultJobOptions: { attempts: 3 } },
      workerConfig: { concurrency: 5 },
    });

    expect(result.job.queueConfig).toEqual({
      defaultJobOptions: { attempts: 3 },
    });
    expect(result.job.workerConfig).toEqual({ concurrency: 5 });
  });

  it('includes repeat config for cron jobs', () => {
    const result = createJob('cron-job', async () => {}, {
      repeat: { pattern: '*/5 * * * *' },
    });

    expect(result.job.repeat).toEqual({ pattern: '*/5 * * * *' });
  });

  it('does not include name in options spread', () => {
    const result = createJob('my-job', async () => {});

    expect(result.job.name).toBe('my-job');
    expect(result.job.queueConfig).toBeUndefined();
    expect(result.job.workerConfig).toBeUndefined();
    expect(result.job.repeat).toBeUndefined();
  });
});
