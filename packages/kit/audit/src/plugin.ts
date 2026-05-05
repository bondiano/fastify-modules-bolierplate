import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';
import type { Insertable } from 'kysely';

import { computeDiff, DEFAULT_REDACT_PATTERNS } from './diff.js';
import type { AuditLogTable } from './schema.js';

/**
 * Canonical insert shape used by the plugin -- DB-free so the plugin
 * doesn't need a generic. For any `DB extends AuditDB`,
 * `Insertable<DB['audit_log']>` is structurally identical to
 * `Insertable<AuditLogTable>` (interface property invariance), so the
 * consumer's `auditLogRepository.appendMany(...)` accepts arrays of this
 * shape directly.
 */
type AuditLogInsertCanonical = Insertable<AuditLogTable>;

/**
 * The slice of `AuditLogRepository` that the plugin actually calls. Defining
 * a slimmer interface keeps the plugin DB-generic-agnostic -- consumers'
 * `auditLogRepository` (parameterized over their own `DB`) structurally
 * satisfies this without variance gymnastics.
 */
export interface AuditAppender {
  appendMany(entries: readonly AuditLogInsertCanonical[]): Promise<void>;
}

export interface AuditSubject {
  readonly type: string;
  readonly id: string;
}

export interface AuditDiffInput {
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  /** Per-call sensitive field overrides on top of the plugin's
   * `redactPatterns`. Use when the call site knows about columns the global
   * patterns miss (e.g. `pin`, `mfaSeed`). */
  readonly sensitiveColumns?: readonly string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Records an audit entry into a request-scoped buffer. The buffer is
     * flushed by the plugin's `onResponse` / `onError` hook in a single
     * `appendMany` call, so handlers should treat this as fire-and-forget
     * (the return type is `void`, not `Promise<void>`).
     *
     * Failure to persist is logged but never thrown -- audit failure must
     * not break the response.
     */
    audit: (
      action: string,
      subject: AuditSubject,
      diff?: AuditDiffInput,
      metadata?: Record<string, unknown>,
    ) => void;
  }
  interface FastifyContextConfig {
    /**
     * Mark a route to skip audit-buffer flushing entirely. Useful for
     * extremely hot health-check / readiness endpoints where the
     * onResponse hook overhead matters even when nothing has been
     * audited. The decorator itself stays present (calling it on a
     * bypass route is a silent no-op).
     */
    audit?: 'bypass';
  }
}

interface AuditCradle {
  auditLogRepository: AuditAppender;
}

interface FastifyWithDi extends FastifyInstance {
  diContainer: { cradle: AuditCradle };
}

export interface AuditPluginOptions {
  /** Override how the actor (user) id is read off the request.
   * Defaults to `request.auth?.sub`, matching `@kit/auth`'s
   * `AccessTokenPayload`. */
  readonly getActorId?: (request: FastifyRequest) => string | null;
  /** Override how the active tenant id is read.
   * Defaults to `request.tenant?.tenantId ?? null`. */
  readonly getTenantId?: (request: FastifyRequest) => string | null;
  /** Override how the correlation id is read.
   * Defaults to `req.id` (Fastify's request id, populated by `genReqId`). */
  readonly getCorrelationId?: (request: FastifyRequest) => string | null;
  /** Override the redaction pattern set. Defaults to
   * `DEFAULT_REDACT_PATTERNS` (password, token, secret, api[_-]?key, hash). */
  readonly redactPatterns?: readonly RegExp[];
  /** Override how the repository is fetched. Defaults to the Awilix
   * cradle entry `auditLogRepository`. */
  readonly resolveRepository?: (fastify: FastifyInstance) => AuditAppender;
}

interface BufferEntry {
  action: string;
  subject: AuditSubject;
  diff: Record<string, { before: unknown; after: unknown }> | null;
  sensitive: boolean;
  metadata: Record<string, unknown> | null;
}

interface AuditState {
  buffer: BufferEntry[];
  flushed: boolean;
}

const STATE = Symbol('@kit/audit:state');

const defaultGetActorId = (request: FastifyRequest): string | null => {
  const auth = (request as { auth?: { sub?: unknown } }).auth;
  return typeof auth?.sub === 'string' ? auth.sub : null;
};

const defaultGetTenantId = (request: FastifyRequest): string | null => {
  const tenant = (request as { tenant?: { tenantId?: unknown } }).tenant;
  return typeof tenant?.tenantId === 'string' ? tenant.tenantId : null;
};

const defaultGetCorrelationId = (request: FastifyRequest): string | null => {
  const id = (request as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

const auditPlugin: FastifyPluginAsync<AuditPluginOptions> = async (
  fastify,
  opts,
) => {
  const getActorId = opts.getActorId ?? defaultGetActorId;
  const getTenantId = opts.getTenantId ?? defaultGetTenantId;
  const getCorrelationId = opts.getCorrelationId ?? defaultGetCorrelationId;
  const redactPatterns = opts.redactPatterns ?? DEFAULT_REDACT_PATTERNS;
  const resolveRepository =
    opts.resolveRepository ??
    ((f: FastifyInstance) =>
      (f as FastifyWithDi).diContainer.cradle.auditLogRepository);

  const repository = resolveRepository(fastify);

  // Declare the decorator slot without an initial value -- per-request
  // assignment happens in `onRequest`. Fastify v5 rejects `null` here
  // because the signature expects a `GetterSetter` function.
  fastify.decorateRequest('audit');

  fastify.addHook('onRequest', async (request) => {
    const state: AuditState = { buffer: [], flushed: false };
    (request as unknown as Record<symbol, unknown>)[STATE] = state;

    request.audit = (action, subject, diff, metadata) => {
      // Bypass routes still receive the decorator (so handlers don't have
      // to feature-detect), but calls become no-ops.
      if (request.routeOptions.config?.audit === 'bypass') return;

      const { diff: computed, sensitive } = diff
        ? computeDiff(diff.before ?? null, diff.after ?? null, {
            redactPatterns,
            ...(diff.sensitiveColumns
              ? { sensitiveColumns: diff.sensitiveColumns }
              : {}),
          })
        : { diff: null, sensitive: false };

      state.buffer.push({
        action,
        subject,
        diff: computed,
        sensitive,
        metadata: metadata ?? null,
      });
    };
  });

  const flush = async (
    request: FastifyRequest,
    reply: FastifyReply | null,
  ): Promise<void> => {
    const state = (request as unknown as Record<symbol, unknown>)[STATE] as
      | AuditState
      | undefined;
    if (!state || state.flushed || state.buffer.length === 0) {
      if (state) state.flushed = true;
      return;
    }
    state.flushed = true;

    const tenantId = getTenantId(request);
    const actorId = getActorId(request);
    const correlationId = getCorrelationId(request);
    const ip = request.ip ?? null;
    const userAgent =
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : null;
    const statusCode = reply?.statusCode ?? 0;

    const entries: AuditLogInsertCanonical[] = state.buffer.map((entry) => ({
      tenantId,
      actorId,
      subjectType: entry.subject.type,
      subjectId: entry.subject.id,
      action: entry.action,
      diff: entry.diff,
      metadata: {
        statusCode,
        correlationId,
        ...entry.metadata,
      },
      ip,
      userAgent,
      correlationId,
      sensitive: entry.sensitive,
    }));

    try {
      await repository.appendMany(entries);
    } catch (error) {
      // Audit failure must NOT propagate -- the response is already
      // committed by the time onResponse fires, and on the onError path
      // we'd be masking the real error.
      fastify.log.error(
        { err: error, count: entries.length },
        '@kit/audit: failed to persist audit entries',
      );
    }
  };

  // Single hook on `onResponse`. It fires AFTER the error handler has
  // sent its reply, so `reply.statusCode` is correct for both happy and
  // error paths. Hooking `onError` instead would fire before the error
  // handler runs and capture the default 200 -- not useful.
  fastify.addHook('onResponse', async (request, reply) => {
    await flush(request, reply);
  });
};

export const createAuditPlugin = fp(auditPlugin, {
  name: '@kit/audit',
  dependencies: ['@fastify/awilix'],
});

export default createAuditPlugin;
