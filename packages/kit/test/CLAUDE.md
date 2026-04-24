# @kit/test

Shared test utilities for the Fastify SaaS Kit. Supplies an in-memory
PGlite-backed Kysely data source, a migration runner, table truncator,
integration-test harness, and Vitest auto-mocks for Redis / BullMQ.

All helpers are opt-in -- nothing here runs just from importing the package.

## Directory

```
src/
  database/
    create-test-data-source.ts  createTestDataSource (Kysely + PGlite + CamelCase + BinaryTransform)
    migrate.ts                  migrateToLatest (FileMigrationProvider against migrations dir)
    truncate-tables.ts          truncateTables (introspects schema, TRUNCATE ... CASCADE)
  helpers/
    setup-integration-test.ts   setupIntegrationTest (beforeAll/beforeEach wiring + lazy proxy)
    auth.ts                     buildAuthHeaders (Bearer header helper)
  setup/
    redis-mock.ts               vi.mock('@fastify/redis') -- setupFiles entry
    bull-mock.ts                vi.mock('bullmq')          -- setupFiles entry
  index.ts                      Public barrel
```

Exports are also available at sub-paths: `@kit/test/database`,
`@kit/test/helpers`, `@kit/test/setup/redis-mock`, `@kit/test/setup/bull-mock`.

## Key ideas

- **PGlite, not real Postgres.** Tests run an in-process WebAssembly Postgres
  per worker (via `kysely-pglite`). Fast, deterministic, no docker. The
  data source mirrors the production one -- same `CamelCasePlugin`,
  `DeduplicateJoinsPlugin` -- plus `BinaryTransformPlugin` which converts
  PGlite's `Uint8Array` columns to Node `Buffer` so app code that expects
  `pg` driver behavior Just Works.
- **One data source per test file.** `setupIntegrationTest` calls `createApp`
  inside `beforeAll`, so each Vitest worker runs its own PGlite instance.
  Between tests we only `TRUNCATE ... CASCADE`; the schema stays migrated.
- **Lazy proxy return.** `setupIntegrationTest` returns `server` and
  `dataSource` as proxies so you can destructure them at the top of `describe`
  before `beforeAll` has actually booted the app. Accessing a method before
  boot throws naturally -- don't rely on lazy evaluation outside test hooks.
- **Auto-mocks as setupFiles, not imports.** `redis-mock` and `bull-mock`
  live under `src/setup/` and register `vi.mock(...)` hoisted to the top of
  every test. Wire them in `vitest.config.ts` `setupFiles`, don't import them
  from a spec.

## Using in a service

### `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  envDir: '../../',
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
    setupFiles: ['@kit/test/setup/redis-mock', '@kit/test/setup/bull-mock'],
    sequence: { setupFiles: 'list', hooks: 'stack', shuffle: { files: true } },
    forks: { execArgv: ['--experimental-strip-types'] },
    env: { ENVIRONMENT: 'test' },
    hookTimeout: 60_000,
  },
});
```

Spec files use `*.spec.ts`. Reserve `*.test.ts` for unit tests that don't
need the integration harness, if you want finer-grained filtering.

### Booting a full test app

```ts
// src/__tests__/helpers/test-app.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '#config.ts';
import type { DB } from '#db/schema.ts';
import { createServer } from '#server/create.ts';
import { authProvider } from '@kit/auth/provider';
import { createContainer } from '@kit/core/di';
import { createLogger } from '@kit/core/logger';
import { dbProvider } from '@kit/db/runtime';
import { createTransactionStorage } from '@kit/db/transaction';
import { createTestDataSource, migrateToLatest } from '@kit/test/database';
import type { TestApp } from '@kit/test/helpers';
import Redis from 'ioredis-mock';

const migrationsPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

export const createTestApp = async (): Promise<TestApp<DB>> => {
  const logger = createLogger({ name: 'test', level: 'silent' });
  const dataSource = await createTestDataSource<DB>();
  const transactionStorage = await createTransactionStorage<DB>();
  const redis = new Redis();

  // Run migrations BEFORE server boot -- @kit/admin queries
  // information_schema during plugin registration.
  await migrateToLatest(dataSource, migrationsPath);

  const container = await createContainer({
    logger,
    config,
    extraValues: { dataSource, transactionStorage, redis },
    modulesGlobs: [
      `${import.meta.dirname}/../../modules/**/*.{repository,service,mapper,client}.{js,ts}`,
    ],
    providers: [dbProvider(), authProvider({ ... })],
  });

  const server = await createServer({
    config, container, logger, redis,
    security: { rateLimit: false },
  });

  return { server, dataSource };
};
```

### Wiring the harness

```ts
// src/__tests__/helpers/setup-integration-test.ts
import type { DB } from '#db/schema.ts';
import { setupIntegrationTest as setup } from '@kit/test/helpers';

import { createTestApp } from './test-app.ts';

export const setupIntegrationTest = () =>
  setup<DB>({
    createApp: createTestApp,
    // migrations run inside createTestApp, so no migrationsPath here
    beforeEachCleanup: ({ server }) => {
      // flush ioredis-mock between tests
      (server.redis as { flushall: () => void }).flushall();
    },
  });
```

### Writing a spec

```ts
// src/modules/posts/posts.route.spec.ts
import { describe, expect, it } from 'vitest';

import { setupIntegrationTest } from '#__tests__/helpers/setup-integration-test.ts';
import { buildAuthHeaders } from '@kit/test/helpers';

describe('POST /api/v1/posts', () => {
  const { server, dataSource } = setupIntegrationTest();

  it('creates a post', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: buildAuthHeaders(accessToken),
      payload: { title: 'Hello', content: '...' },
    });
    expect(response.statusCode).toBe(201);
  });
});
```

## Fixture pattern

Fixtures live in `services/<service>/src/__tests__/fixtures/` and expose a
factory that takes the test `dataSource` and returns helpers that seed rows:

```ts
// src/__tests__/fixtures/users.ts
import type { Kysely } from 'kysely';
import type { DB } from '#db/schema.ts';

export const createUsersFixtures = (dataSource: Kysely<DB>) => ({
  async createUser(overrides: Partial<NewUser> = {}) {
    return dataSource
      .insertInto('users')
      .values({ email: `u-${crypto.randomUUID()}@t.test`, ...overrides })
      .returningAll()
      .executeTakeFirstOrThrow();
  },
});
```

Keep fixtures side-effect-only (insert rows, return rows). They do **not**
call service methods -- that would couple tests to the very code they exercise.

## DI container for unit tests

Unit-testing a service in isolation doesn't need PGlite at all -- build an
Awilix container with hand-mocked deps:

```ts
import { asValue } from 'awilix';
import { createContainer } from '@kit/core/di';
import { createPostsService } from './posts.service.ts';

const container = await createContainer({
  logger: silentLogger,
  config: testConfig,
  extraValues: {
    postsRepository: {
      findById: vi.fn().mockResolvedValue({ id: '1', title: 'x' }),
      // ...other methods
    },
  },
});
const service = createPostsService({
  postsRepository: container.cradle.postsRepository,
});
```

For service-level unit tests, inject mocks directly into the factory -- the
container step is only needed when you want Awilix resolution behavior too.

## Auto-mocks

- **`@kit/test/setup/redis-mock`** -- replaces `@fastify/redis` with a plugin
  that decorates Fastify with an `ioredis-mock` client. Test app can behave
  as if Redis is attached without a real connection.
- **`@kit/test/setup/bull-mock`** -- stubs `bullmq`'s `Queue` class so
  `queue.add(name, data)` pushes onto an ioredis-mock list. No BullMQ worker
  logic runs. Use this for unit-level assertions that a job was enqueued;
  write separate worker tests for job handlers.

Both are `setupFiles` entries -- they hoist `vi.mock` before any app import.

## Gotchas

- **PGlite vs. Postgres parity**: PGlite is real Postgres-compiled-to-wasm so
  SQL is identical, but extensions like `pg_cron`, `pg_stat_statements`,
  or `pgvector` aren't included. Don't add migrations that require them
  without gating by `ENVIRONMENT`.
- **Migrations must run before the server boots** when `@kit/admin` is
  registered -- it introspects `information_schema` during plugin init.
  That's why `migrateToLatest` is called inside `createTestApp`, not via
  the harness's `migrationsPath` option.
- **Do not share the data source across workers.** Each Vitest worker calls
  `createTestDataSource()` which spins up its own PGlite. Parallel files get
  clean databases for free.
- **`truncate: ['users']` vs. auto-discovery**: omit `truncate` and every
  user table is wiped. Specify only when you want to preserve seed data that
  lives in a table.
- **ioredis-mock's types are outdated** -- the package's `setup/redis-mock.ts`
  uses `@ts-expect-error` on the import. Mirror that when you need to
  instantiate it directly in a test.
