/**
 * `DELETE /:resource/:id` and `POST /:resource/bulk-delete`.
 *
 * The single-record delete expects htmx and returns an empty response
 * so the row is swapped out by `hx-swap="outerHTML"`. Bulk delete
 * accepts a JSON body `{ ids: string[] }` and uses `repo.bulkDelete`
 * when available, falling back to a serial loop.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { match } from 'ts-pattern';

import { BadRequestException, NotFoundException } from '@kit/errors';

import { getRepo } from '../runtime/context.js';
import type { AdminDiscoverable } from '../types.js';

import {
  _adminAuditToRecord,
  assertAdminContext,
  assertTenantForResource,
  emitAuditFromAdmin,
  headerCsrf,
  verifyCsrfOrThrow,
} from './_helpers.js';

interface BulkBody {
  readonly ids?: unknown;
}

const asStringArray = (v: unknown): readonly string[] => {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
};

const hasBulkDelete = (
  repo: AdminDiscoverable,
): repo is AdminDiscoverable & {
  bulkDelete: (ids: readonly string[]) => Promise<number>;
} => typeof repo.bulkDelete === 'function';

export const deleteRoute: FastifyPluginAsync = async (fastify) => {
  fastify.delete(
    '/:resource/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);

      const params = request.params as { resource?: string; id?: string };
      const spec = ctx.registry.getOrThrow(params.resource ?? '');
      assertTenantForResource(spec, request);
      const id = params.id ?? '';
      if (id.length === 0) throw new NotFoundException('Missing record id');

      if (
        spec.permissions.subject !== null &&
        typeof fastify.authorize === 'function'
      ) {
        const hook = fastify.authorize('delete', spec.permissions.subject);
        await hook(request);
      }

      verifyCsrfOrThrow(ctx, headerCsrf(request), request);

      const repo = getRepo(ctx, spec);
      const removed = await repo.deleteById(id);
      if (!removed)
        throw new NotFoundException(`${spec.label} ${id} not found`);

      emitAuditFromAdmin(request, spec, 'delete', {
        id,
        before: _adminAuditToRecord(removed),
      });

      reply.status(200).type('text/html; charset=utf-8');
      return '';
    },
  );

  fastify.post(
    '/:resource/bulk-delete',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);

      const params = request.params as { resource?: string };
      const spec = ctx.registry.getOrThrow(params.resource ?? '');
      assertTenantForResource(spec, request);

      if (
        spec.permissions.subject !== null &&
        typeof fastify.authorize === 'function'
      ) {
        const hook = fastify.authorize('delete', spec.permissions.subject);
        await hook(request);
      }

      verifyCsrfOrThrow(ctx, headerCsrf(request), request);

      const body = (request.body ?? {}) as BulkBody;
      const ids = asStringArray(body.ids);
      if (ids.length === 0) throw new BadRequestException('No ids provided');

      const repo = getRepo(ctx, spec);

      // For audit coverage on bulk delete we walk the ids serially so
      // each row gets its own emission with the row's `before` state.
      // The bulk-delete path is rare and admin-only; the per-row cost is
      // acceptable to avoid losing audit fidelity.
      const auditOn = spec.auditEnabled;
      const count = await match({ repo, auditOn })
        .when(
          ({ repo: r, auditOn: a }) => !a && hasBulkDelete(r),
          ({ repo: r }) =>
            (
              r as { bulkDelete: (ids: readonly string[]) => Promise<number> }
            ).bulkDelete(ids),
        )
        .otherwise(async ({ repo: r }) => {
          let n = 0;
          for (const id of ids) {
            const before = auditOn
              ? _adminAuditToRecord(await r.findById(id))
              : null;
            const removed = await r.deleteById(id);
            if (removed) {
              n += 1;
              emitAuditFromAdmin(request, spec, 'delete', { id, before });
            }
          }
          return n;
        });

      reply.type('application/json; charset=utf-8');
      return { deleted: count };
    },
  );
};

export default deleteRoute;
