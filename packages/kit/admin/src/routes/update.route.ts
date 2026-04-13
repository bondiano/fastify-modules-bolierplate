/**
 * `PATCH /:resource/:id` -- partial update. Validates against
 * `spec.validators.update` (TypeBox), re-renders the form with errors
 * on validation failure, and redirects to the list view on success.
 */
import { Value } from '@sinclair/typebox/value';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { NotFoundException } from '@kit/errors';

import { getRepo, isHtmxRequest } from '../runtime/context.js';
import { safeUrl } from '../safe-url.js';
import { Form } from '../views/index.js';

import {
  assertAdminContext,
  collectErrors,
  extractCsrf,
  formatRepoError,
  respondHtml,
  stripMeta,
  verifyCsrfOrThrow,
  type RawBody,
} from './_helpers.js';

export const updateRoute: FastifyPluginAsync = async (fastify) => {
  fastify.patch(
    '/:resource/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);

      const params = request.params as { resource?: string; id?: string };
      const spec = ctx.registry.getOrThrow(params.resource ?? '');
      const id = params.id ?? '';
      if (id.length === 0) throw new NotFoundException('Missing record id');

      if (
        spec.permissions.subject !== null &&
        typeof fastify.authorize === 'function'
      ) {
        const hook = fastify.authorize('update', spec.permissions.subject);
        await hook(request);
      }

      const body = (request.body ?? {}) as RawBody;
      verifyCsrfOrThrow(ctx, extractCsrf(body), request);

      const data = stripMeta(body);
      const schema = spec.validators.update;

      if (!Value.Check(schema, data)) {
        const errors = collectErrors(schema, data);
        const csrfToken = ctx.csrf.issue(request.auth?.sub ?? 'anon');
        const form = Form({
          spec,
          mode: 'update',
          values: data,
          errors,
          prefix: ctx.options.prefix,
          csrfToken,
          action: `${ctx.options.prefix}/${spec.name}/${id}`,
          method: 'PATCH',
        });
        reply.status(422);
        return respondHtml(reply, request, ctx, form, {
          activeResource: spec.name,
        });
      }

      const repo = getRepo(ctx, spec);

      try {
        const updated = await repo.update(id, data);
        if (!updated)
          throw new NotFoundException(`${spec.label} ${id} not found`);
      } catch (error) {
        if (error instanceof NotFoundException) throw error;

        const csrfToken = ctx.csrf.issue(request.auth?.sub ?? 'anon');
        const form = Form({
          spec,
          mode: 'update',
          values: data,
          errors: { _form: formatRepoError(error) },
          prefix: ctx.options.prefix,
          csrfToken,
          action: `${ctx.options.prefix}/${spec.name}/${id}`,
          method: 'PATCH',
        });
        reply.status(422);
        return respondHtml(reply, request, ctx, form, {
          activeResource: spec.name,
        });
      }

      const listUrl = safeUrl(`${ctx.options.prefix}/${spec.name}`);
      if (isHtmxRequest(request)) {
        reply.header('hx-redirect', listUrl);
        reply.status(204);
        return reply;
      }
      reply.redirect(listUrl);
      return reply;
    },
  );
};

export default updateRoute;
