/**
 * `GET /:resource/new` + `POST /:resource` -- create form and submit.
 *
 * Validation runs against `spec.validators.create` (TypeBox). On
 * failure we re-render the form with per-field errors and a 422. On
 * success we redirect to the list view for a full nav request and
 * swap the list body for an htmx request.
 */
import { Value } from '@sinclair/typebox/value';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { isHtmxRequest } from '../runtime/context.js';
import { getRepo } from '../runtime/context.js';
import { safeUrl } from '../safe-url.js';
import { Form } from '../views/index.js';

import {
  _adminAuditToRecord,
  assertAdminContext,
  assertTenantForResource,
  buildRenderValues,
  collectErrors,
  emitAuditFromAdmin,
  extractCsrf,
  formatRepoError,
  respondHtml,
  stripMeta,
  verifyCsrfOrThrow,
  type RawBody,
} from './_helpers.js';

export const createRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/:resource/new',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);

      const params = request.params as { resource?: string };
      const spec = ctx.registry.getOrThrow(params.resource ?? '');
      assertTenantForResource(spec, request);

      if (
        spec.permissions.subject !== null &&
        typeof fastify.authorize === 'function'
      ) {
        const hook = fastify.authorize('create', spec.permissions.subject);
        await hook(request);
      }

      const csrfToken = ctx.csrf.issue(request.auth?.sub ?? 'anon');
      const form = Form({
        spec,
        mode: 'create',
        values: {},
        errors: {},
        prefix: ctx.options.prefix,
        csrfToken,
        action: `${ctx.options.prefix}/${spec.name}`,
        method: 'POST',
      });

      return respondHtml(reply, request, ctx, form, {
        activeResource: spec.name,
      });
    },
  );

  fastify.post(
    '/:resource',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);

      const params = request.params as { resource?: string };
      const spec = ctx.registry.getOrThrow(params.resource ?? '');
      assertTenantForResource(spec, request);

      if (
        spec.permissions.subject !== null &&
        typeof fastify.authorize === 'function'
      ) {
        const hook = fastify.authorize('create', spec.permissions.subject);
        await hook(request);
      }

      const body = (request.body ?? {}) as RawBody;
      verifyCsrfOrThrow(ctx, extractCsrf(body), request);

      const data = stripMeta(body);
      const schema = spec.validators.create;

      if (!Value.Check(schema, data)) {
        const errors = collectErrors(schema, data);
        const csrfToken = ctx.csrf.issue(request.auth?.sub ?? 'anon');
        const form = Form({
          spec,
          mode: 'create',
          values: buildRenderValues(body, data),
          errors,
          prefix: ctx.options.prefix,
          csrfToken,
          action: `${ctx.options.prefix}/${spec.name}`,
          method: 'POST',
        });
        reply.status(422);
        return respondHtml(reply, request, ctx, form, {
          activeResource: spec.name,
        });
      }

      const repo = getRepo(ctx, spec);

      let created: Record<string, unknown> | null;
      try {
        const result = await repo.create(data);
        created = _adminAuditToRecord(result);
      } catch (error) {
        const csrfToken = ctx.csrf.issue(request.auth?.sub ?? 'anon');
        const form = Form({
          spec,
          mode: 'create',
          values: buildRenderValues(body, data),
          errors: { _form: formatRepoError(error) },
          prefix: ctx.options.prefix,
          csrfToken,
          action: `${ctx.options.prefix}/${spec.name}`,
          method: 'POST',
        });
        reply.status(422);
        return respondHtml(reply, request, ctx, form, {
          activeResource: spec.name,
        });
      }

      const id =
        created && typeof created['id'] === 'string'
          ? (created['id'] as string)
          : created && typeof created['id'] === 'number'
            ? String(created['id'])
            : '';
      emitAuditFromAdmin(request, spec, 'create', {
        id,
        after: created,
      });

      const listUrl = safeUrl(`${ctx.options.prefix}/${spec.name}`);
      if (isHtmxRequest(request)) {
        reply.header('hx-redirect', listUrl);
        return reply.status(204).send();
      }
      return reply.redirect(listUrl);
    },
  );
};

export default createRoute;
