import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { migrateToLatest } from '../database/migrate.js';
import { truncateTables } from '../database/truncate-tables.js';

export interface TestApp<DB> {
  server: FastifyInstance;
  dataSource: Kysely<DB>;
}

export interface SetupIntegrationTestOptions<DB> {
  /** Factory that boots the full Fastify app with DI + PGlite data source. */
  readonly createApp: () => Promise<TestApp<DB>>;
  /**
   * Absolute path to the migrations directory.
   * When omitted, migrations are assumed to have already been run
   * (e.g. inside `createApp`).
   */
  readonly migrationsPath?: string;
  /** Tables to truncate between tests. When omitted, all tables are truncated. */
  readonly truncate?: readonly string[];
  /** Called after truncation in beforeEach. Use for Redis flushall, etc. */
  readonly beforeEachCleanup?: (app: TestApp<DB>) => Promise<void> | void;
}

/**
 * Creates a lazy proxy so that `server` and `dataSource` can be destructured
 * at the top of `describe()` before `beforeAll` runs.
 */
const createProxy = <C extends Record<T, object>, T extends string | symbol>(
  context: C,
  target: T,
): C[T] =>
  new Proxy({} as C[T], {
    get(_: C[T], key: string | symbol) {
      const property = (context[target] as Record<string | symbol, unknown>)[
        key
      ];
      return typeof property === 'function'
        ? (property as (...args: unknown[]) => unknown).bind(context[target])
        : property;
    },
  });

/**
 * Sets up a full integration test suite:
 *
 * - `beforeAll`: creates the app, runs migrations
 * - `beforeEach`: truncates tables + optional cleanup (e.g. Redis flush)
 * - `afterEach`: restores real timers
 *
 * Returns proxied `server` and `dataSource` that can be destructured
 * immediately despite late initialization.
 *
 * @example
 * ```ts
 * const { server, dataSource } = setupIntegrationTest({
 *   createApp: () => createTestApp(),
 *   migrationsPath: path.join(import.meta.dirname, '../../migrations'),
 * });
 *
 * describe('POST /api/users', () => {
 *   it('creates a user', async () => {
 *     const response = await server.inject({ method: 'POST', url: '/api/users', payload: { ... } });
 *     expect(response.statusCode).toBe(201);
 *   });
 * });
 * ```
 */
export const setupIntegrationTest = <DB>(
  options: SetupIntegrationTestOptions<DB>,
): TestApp<DB> => {
  const { createApp, migrationsPath, truncate, beforeEachCleanup } = options;
  const app = {} as TestApp<DB>;

  beforeAll(async () => {
    const testApp = await createApp();

    if (migrationsPath) {
      await migrateToLatest(testApp.dataSource, migrationsPath);
    }

    app.server = testApp.server;
    app.dataSource = testApp.dataSource;
  });

  beforeEach(async () => {
    await truncateTables(app.dataSource, truncate);

    if (beforeEachCleanup) {
      await beforeEachCleanup(app);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  return {
    server: createProxy(app, 'server'),
    dataSource: createProxy(app, 'dataSource'),
  };
};
