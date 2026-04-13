import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// --- Health check registry ---

export interface HealthCheckResult {
  status: 'up' | 'down';
  details?: unknown;
}

export interface HealthCheck {
  readonly name: string;
  readonly check: () => Promise<HealthCheckResult>;
}

export interface HealthPluginOptions {
  /**
   * URL prefix for the public status endpoint (e.g. `/api/v1/status`).
   * Pass `false` to disable the status endpoint entirely.
   * @default false
   */
  statusPrefix?: string | false;
}

declare module 'fastify' {
  interface FastifyInstance {
    healthChecks: HealthCheck[];
    addHealthCheck: (check: HealthCheck) => void;
  }
}

const healthPlugin = async (
  fastify: FastifyInstance,
  options: HealthPluginOptions = {},
) => {
  const { APP_NAME, APP_VERSION } = fastify.config;
  const startedAt = Date.now();

  // --- Health check registry ---
  fastify.decorate('healthChecks', [] as HealthCheck[]);
  fastify.decorate('addHealthCheck', (check: HealthCheck) => {
    fastify.healthChecks.push(check);
  });

  // --- Liveness: GET /health ---
  fastify.route({
    method: 'GET',
    url: '/health',
    schema: {
      tags: ['Health'],
      response: {
        200: Type.Object({
          status: Type.Literal('ok'),
          name: Type.String(),
          version: Type.String(),
          uptime: Type.Number(),
        }),
      },
    },
    handler: async () => ({
      status: 'ok' as const,
      name: APP_NAME,
      version: APP_VERSION,
      uptime: (Date.now() - startedAt) / 1000,
    }),
  });

  // --- Readiness: GET /health/ready ---
  const readyResponseSchema = Type.Object({
    status: Type.Union([Type.Literal('ready'), Type.Literal('degraded')]),
    checks: Type.Record(
      Type.String(),
      Type.Object({
        status: Type.Union([Type.Literal('up'), Type.Literal('down')]),
        details: Type.Optional(Type.Unknown()),
      }),
    ),
  });

  fastify.route({
    method: 'GET',
    url: '/health/ready',
    schema: {
      tags: ['Health'],
      response: {
        200: readyResponseSchema,
        503: readyResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const results = await Promise.allSettled(
        fastify.healthChecks.map(async (hc) => ({
          name: hc.name,
          result: await hc.check(),
        })),
      );

      const checks: Record<string, HealthCheckResult> = {};
      let allUp = true;

      for (const entry of results) {
        if (entry.status === 'fulfilled') {
          checks[entry.value.name] = entry.value.result;
          if (entry.value.result.status === 'down') allUp = false;
        } else {
          allUp = false;
          checks['unknown'] = { status: 'down', details: String(entry.reason) };
        }
      }

      const body = {
        status: allUp ? ('ready' as const) : ('degraded' as const),
        checks,
      };

      return reply.status(allUp ? 200 : 503).send(body);
    },
  });

  // --- Public status: GET /{statusPrefix} (optional) ---
  if (options.statusPrefix) {
    fastify.route({
      method: 'GET',
      url: options.statusPrefix,
      schema: {
        tags: ['Health'],
        response: {
          200: Type.Object({
            status: Type.Literal('ok'),
            name: Type.String(),
            version: Type.String(),
          }),
        },
      },
      handler: async () => ({
        status: 'ok' as const,
        name: APP_NAME,
        version: APP_VERSION,
      }),
    });
  }
};

export default fp(healthPlugin, {
  name: 'health',
  dependencies: ['config'],
});
