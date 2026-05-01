/**
 * `GET /:resource/:id` -- edit form for a single record. Loads the row
 * via `repository.findById`, throws `NotFoundException` when missing, and
 * renders the generic `Form` component in update mode.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { NotFoundException } from '@kit/errors';

import { getRepo } from '../runtime/context.js';
import { Form } from '../views/index.js';

import {
  assertAdminContext,
  assertTenantForResource,
  respondHtml,
} from './_helpers.js';

export const detailRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
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
        const hook = fastify.authorize('read', spec.permissions.subject);
        await hook(request);
      }

      const repo = getRepo(ctx, spec);
      const record = await repo.findById(id);
      if (!record) throw new NotFoundException(`${spec.label} ${id} not found`);

      const csrfToken = ctx.csrf.issue(request.auth?.sub ?? 'anon');

      const form = Form({
        spec,
        mode: 'update',
        values: record as Record<string, unknown>,
        errors: {},
        prefix: ctx.options.prefix,
        csrfToken,
        action: `${ctx.options.prefix}/${spec.name}/${id}`,
        method: 'PATCH',
        id,
      });

      return respondHtml(reply, request, ctx, form, {
        activeResource: spec.name,
      });
    },
  );
};

export default detailRoute;
