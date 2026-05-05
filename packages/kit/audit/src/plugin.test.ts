import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Insertable } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAuditPlugin,
  type AuditAppender,
  type AuditPluginOptions,
} from './plugin.js';
import type { AuditLogTable } from './schema.js';

type AuditLogInsert = Insertable<AuditLogTable>;

interface BuildOptions {
  appender?: AuditAppender;
  registerRoutes?: (fastify: FastifyInstance) => void | Promise<void>;
  pluginOptions?: Partial<AuditPluginOptions>;
  /** When set, decorates `request.auth` / `request.tenant` from the matching
   * header so the default getters can pick them up. */
  authFromHeader?: boolean;
  loggerErrorSink?: (...args: unknown[]) => void;
}

const buildFastify = async ({
  appender,
  registerRoutes,
  pluginOptions,
  authFromHeader,
  loggerErrorSink,
}: BuildOptions = {}) => {
  const fastify = Fastify({ logger: false });
  if (loggerErrorSink) {
    (fastify.log as unknown as { error: typeof loggerErrorSink }).error =
      loggerErrorSink;
  }

  const captured: AuditLogInsert[] = [];
  const recordingAppender: AuditAppender = appender ?? {
    appendMany: async (entries) => {
      captured.push(...entries);
    },
  };

  fastify.decorate('diContainer', {
    cradle: { auditLogRepository: recordingAppender },
  });

  fastify.setErrorHandler((rawError, _request, reply) => {
    const error = rawError as { statusCode?: number; message?: string };
    reply.status(error.statusCode ?? 500).send({ message: error.message });
  });

  await fastify.register(
    fp(async (): Promise<void> => {}, { name: '@fastify/awilix' }),
  );

  if (authFromHeader) {
    fastify.addHook('onRequest', async (req) => {
      const userHeader = req.headers['x-user-id'];
      const tenantHeader = req.headers['x-tenant-id'];
      if (typeof userHeader === 'string') {
        (req as unknown as { auth: { sub: string } }).auth = {
          sub: userHeader,
        };
      }
      if (typeof tenantHeader === 'string') {
        (req as unknown as { tenant: { tenantId: string } }).tenant = {
          tenantId: tenantHeader,
        };
      }
    });
  }

  await fastify.register(
    createAuditPlugin,
    pluginOptions as AuditPluginOptions,
  );

  await registerRoutes?.(fastify);
  await fastify.ready();
  return { fastify, captured, appender: recordingAppender };
};

describe('createAuditPlugin (integration)', () => {
  let harness: Awaited<ReturnType<typeof buildFastify>> | undefined;

  beforeEach(() => {
    harness = undefined;
  });
  afterEach(async () => {
    await harness?.fastify.close();
  });

  it('decorates request.audit on every request', async () => {
    let saw: unknown = 'not-set';
    harness = await buildFastify({
      registerRoutes: (f) => {
        f.get('/ping', async (req) => {
          saw = typeof req.audit;
          return { ok: true };
        });
      },
    });
    const res = await harness.fastify.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(saw).toBe('function');
  });

  it('flushes a single-call buffer in onResponse with auto-enriched metadata', async () => {
    harness = await buildFastify({
      authFromHeader: true,
      registerRoutes: (f) => {
        f.post('/widgets/:id', async (req) => {
          req.audit('update', { type: 'Widget', id: 'w-1' }, undefined, {
            note: 'hello',
          });
          return { ok: true };
        });
      },
    });
    const res = await harness.fastify.inject({
      method: 'POST',
      url: '/widgets/w-1',
      headers: {
        'x-user-id': 'u-42',
        'x-tenant-id': 't-7',
        'user-agent': 'vitest/audit',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(harness.captured).toHaveLength(1);
    const entry = harness.captured[0]!;
    expect(entry.action).toBe('update');
    expect(entry.subjectType).toBe('Widget');
    expect(entry.subjectId).toBe('w-1');
    expect(entry.actorId).toBe('u-42');
    expect(entry.tenantId).toBe('t-7');
    expect(entry.userAgent).toBe('vitest/audit');
    expect(entry.correlationId).toBeTypeOf('string');
    expect(entry.correlationId).not.toBe('');
    expect(entry.metadata).toMatchObject({
      statusCode: 200,
      correlationId: entry.correlationId,
      note: 'hello',
    });
  });

  it('batches multiple audit calls into a single appendMany invocation', async () => {
    const appendMany = vi.fn().mockResolvedValue();
    harness = await buildFastify({
      appender: { appendMany },
      registerRoutes: (f) => {
        f.post('/bulk', async (req) => {
          req.audit('create', { type: 'Item', id: 'i-1' });
          req.audit('create', { type: 'Item', id: 'i-2' });
          req.audit('create', { type: 'Item', id: 'i-3' });
          return { ok: true };
        });
      },
    });
    await harness.fastify.inject({ method: 'POST', url: '/bulk', payload: {} });
    expect(appendMany).toHaveBeenCalledTimes(1);
    expect(appendMany.mock.calls[0]![0]).toHaveLength(3);
  });

  it('still flushes when the handler throws (onError path)', async () => {
    harness = await buildFastify({
      registerRoutes: (f) => {
        f.post('/boom', async (req) => {
          req.audit(
            'attempted-delete',
            { type: 'Post', id: 'p-1' },
            undefined,
            { reason: 'gate-rejected' },
          );
          throw new Error('nope');
        });
      },
    });
    const res = await harness.fastify.inject({
      method: 'POST',
      url: '/boom',
      payload: {},
    });
    expect(res.statusCode).toBe(500);
    expect(harness.captured).toHaveLength(1);
    expect(harness.captured[0]!.action).toBe('attempted-delete');
    expect(
      (harness.captured[0]!.metadata as Record<string, unknown>).statusCode,
    ).toBe(500);
  });

  it('logs but does not throw when the repository fails', async () => {
    const errorSink = vi.fn();
    const failing: AuditAppender = {
      appendMany: async () => {
        throw new Error('db down');
      },
    };
    harness = await buildFastify({
      appender: failing,
      loggerErrorSink: errorSink,
      registerRoutes: (f) => {
        f.post('/audit-fail', async (req) => {
          req.audit('create', { type: 'X', id: 'y' });
          return { ok: true };
        });
      },
    });
    const res = await harness.fastify.inject({
      method: 'POST',
      url: '/audit-fail',
      payload: {},
    });
    // Response still succeeds.
    expect(res.statusCode).toBe(200);
    expect(errorSink).toHaveBeenCalled();
  });

  it('skips the flush entirely on routes marked audit: bypass', async () => {
    const appendMany = vi.fn().mockResolvedValue();
    harness = await buildFastify({
      appender: { appendMany },
      registerRoutes: (f) => {
        f.get('/health', { config: { audit: 'bypass' } }, async (req) => {
          // Calling on a bypass route is a silent no-op.
          req.audit('create', { type: 'X', id: 'y' });
          return { ok: true };
        });
      },
    });
    await harness.fastify.inject({ method: 'GET', url: '/health' });
    expect(appendMany).not.toHaveBeenCalled();
  });

  it('writes nothing when no audit() call was made (no empty INSERT)', async () => {
    const appendMany = vi.fn().mockResolvedValue();
    harness = await buildFastify({
      appender: { appendMany },
      registerRoutes: (f) => {
        f.get('/silent', async () => ({ ok: true }));
      },
    });
    await harness.fastify.inject({ method: 'GET', url: '/silent' });
    expect(appendMany).not.toHaveBeenCalled();
  });

  it('redacts password-shaped fields in the diff before persisting', async () => {
    harness = await buildFastify({
      registerRoutes: (f) => {
        f.post('/users', async (req) => {
          req.audit(
            'create',
            { type: 'User', id: 'u-1' },
            {
              after: { email: 'a@b.com', password: 's3cret' },
            },
          );
          return { ok: true };
        });
      },
    });
    await harness.fastify.inject({
      method: 'POST',
      url: '/users',
      payload: {},
    });
    expect(harness.captured).toHaveLength(1);
    const entry = harness.captured[0]!;
    expect(entry.sensitive).toBe(true);
    expect(entry.diff).toMatchObject({
      email: { before: null, after: 'a@b.com' },
      password: { before: null, after: '[REDACTED]' },
    });
  });

  it('honours custom getActorId / getTenantId / getCorrelationId', async () => {
    harness = await buildFastify({
      pluginOptions: {
        getActorId: () => 'custom-actor',
        getTenantId: () => 'custom-tenant',
        getCorrelationId: (req: FastifyRequest) =>
          (req.headers['x-trace-id'] as string | undefined) ?? null,
      },
      registerRoutes: (f) => {
        f.post('/custom', async (req) => {
          req.audit('a', { type: 't', id: 'i' });
          return { ok: true };
        });
      },
    });
    await harness.fastify.inject({
      method: 'POST',
      url: '/custom',
      payload: {},
      headers: { 'x-trace-id': 'trace-99' },
    });
    expect(harness.captured[0]!.actorId).toBe('custom-actor');
    expect(harness.captured[0]!.tenantId).toBe('custom-tenant');
    expect(harness.captured[0]!.correlationId).toBe('trace-99');
  });
});
