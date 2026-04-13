# @kit/jobs

Background job processing abstraction over BullMQ for the Fastify SaaS Kit.
Provides a typed `createJob` factory, auto-discovery of job files via glob,
BullBoard UI for dev, and graceful shutdown of workers/queues.

## Directory

```
src/
  types.ts        Jobs/Queues/Workers global interfaces + Fastify/DI augmentation
  create-job.ts   createJob factory (returns frozen { job, handler })
  config.ts       jobsConfigSchema fragment (REDIS_URL)
  plugin.ts       Fastify plugin: auto-discover jobs, create queues/workers, BullBoard
```

## Key ideas

- **Convention-based discovery.** Job files matching a glob pattern (e.g.
  `modules/**/jobs/**/*.job.ts`) are auto-imported. The queue name is derived
  from the parent directory of each job file.
- **Global type augmentation.** Each job file augments the `Jobs` and `Queues`
  interfaces from `@kit/jobs` for end-to-end type safety when adding/processing
  jobs.
- **Function handlers.** Job handlers receive `(fastify, job)` and resolve
  services from `fastify.diContainer.cradle`. No classes or decorators.
- **Frozen configs.** `createJob()` returns a frozen object to prevent runtime
  mutation of job definitions.
- **No Redis ownership.** The plugin receives a Redis (ioredis) connection and
  duplicates it for queue/subscriber clients. Redis lifecycle is managed
  externally (typically via `@fastify/redis`).

## Wiring sketch (in services/api)

```ts
// services/api/src/server/plugins/jobs.ts
import { createJobsPlugin } from '@kit/jobs/plugin';
import fp from 'fastify-plugin';

export default fp(
  async (fastify) => {
    await fastify.register(createJobsPlugin, {
      jobsPathPattern: `${import.meta.dirname}/../../modules/**/jobs/**/*.job.{js,ts}`,
      redis: fastify.redis, // from @fastify/redis plugin
      bullBoard: fastify.config.isDev ? '/admin/queues' : false,
    });
  },
  {
    name: 'jobs',
    dependencies: ['redis', 'di', 'config'],
  },
);
```

## Adding a job

1. Create a job file in your module's `jobs/<queue-name>/` directory:

```ts
// modules/users/jobs/notifications/send-welcome-email.job.ts
import { createJob } from '@kit/jobs';

declare module '@kit/jobs' {
  interface Jobs {
    'send-welcome-email': { userId: string };
  }
  interface Queues {
    notifications: import('bullmq').Queue<Jobs['send-welcome-email']>;
  }
}

export default createJob<Jobs['send-welcome-email']>(
  'send-welcome-email',
  async (fastify, job) => {
    const { usersService } = fastify.diContainer.cradle;
    await usersService.sendWelcomeEmail(job.data.userId);
  },
);
```

2. The plugin auto-discovers and registers the job. No manual wiring needed.

## Dispatching a job

```ts
// In a service or route handler:
const { queues } = fastify.diContainer.cradle;
await queues.notifications.add('send-welcome-email', { userId: '123' });
```

## Cron / repeatable jobs

```ts
export default createJob(
  'cleanup-expired-tokens',
  async (fastify) => {
    const { tokensService } = fastify.diContainer.cradle;
    await tokensService.cleanupExpired();
  },
  {
    repeat: { pattern: '0 * * * *' }, // every hour
  },
);
```

The plugin calls `queue.upsertJobScheduler()` for jobs with a `repeat` option.

## BullBoard

Set `bullBoard: '/admin/queues'` in the plugin options to enable the BullBoard
UI in development. All auto-discovered queues are registered automatically.

## Config

Merge `jobsConfigSchema` into your app config:

```ts
import { jobsConfigSchema } from '@kit/jobs/config';
const config = createConfig({ ...jobsConfigSchema });
```

| Var         | Default | Notes                          |
| ----------- | ------- | ------------------------------ |
| `REDIS_URL` | --      | Required, Redis connection URL |

## Graceful shutdown

The plugin registers a Fastify `onClose` hook that:

1. Closes all workers (waits for in-flight jobs)
2. Closes all queues
3. Disconnects duplicated Redis clients
