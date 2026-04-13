/**
 * `GET /` -- dashboard landing page. Lists every registered resource as
 * a card linking to its list view.
 *
 * For v1 simplicity we don't fetch per-resource counts; that would add
 * N queries on every dashboard hit with no caching. A follow-up can add
 * a cached counts side-table.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { html } from 'htm/preact';

import { safeUrl } from '../safe-url.js';

import { assertAdminContext, respondHtml } from './_helpers.js';

const buildBody = (
  prefix: string,
  resources: readonly { name: string; label: string }[],
) => {
  if (resources.length === 0) {
    return html`<section class="admin-dashboard">
      <h1>Dashboard</h1>
      <p class="muted">No resources registered.</p>
    </section>`;
  }

  return html`<section class="admin-dashboard">
    <h1>Dashboard</h1>
    <ul class="admin-dashboard__grid">
      ${resources.map((r) => {
        const href = safeUrl(`${prefix}/${r.name}`);
        return html`<li class="admin-dashboard__card">
          <a
            href=${href}
            hx-get=${href}
            hx-target="#admin-main"
            hx-swap="innerHTML"
            hx-push-url="true"
          >
            <h2>${r.label}</h2>
            <span class="muted">${r.name}</span>
          </a>
        </li>`;
      })}
    </ul>
  </section>`;
};

export const dashboardRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = assertAdminContext(fastify);

    const resources = ctx.registry
      .all()
      .map((spec) => ({ name: spec.name, label: spec.label }));

    return respondHtml(
      reply,
      request,
      ctx,
      buildBody(ctx.options.prefix, resources),
    );
  });
};

export default dashboardRoute;
