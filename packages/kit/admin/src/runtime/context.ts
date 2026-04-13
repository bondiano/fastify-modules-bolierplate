/**
 * Runtime context shared between the admin plugin and its route modules.
 *
 * The plugin builds an `AdminContext` once during boot (registry, repo
 * map, csrf service, runtime options) and decorates the admin scope with
 * it so individual route plugins pull everything they need off
 * `fastify.admin` without importing each other.
 */
import type { FastifyRequest } from 'fastify';

import { InternalServerErrorException } from '@kit/errors';

import type { PageRenderContext } from '../render.js';
import type { AdminDiscoverable, AdminResourceSpec } from '../types.js';

import type { CsrfService } from './csrf.js';
import type { InternalAdminRegistry } from './registry.js';

export interface AdminRuntimeOptions {
  readonly prefix: string;
  readonly assetPrefix: string;
  readonly title: string;
}

export interface AdminContext {
  readonly registry: InternalAdminRegistry;
  readonly repos: ReadonlyMap<string, AdminDiscoverable>;
  readonly csrf: CsrfService;
  readonly options: AdminRuntimeOptions;
}

/**
 * Local re-declaration of the subset of the `@kit/auth` + `@kit/authz`
 * Fastify augmentations we rely on. We re-declare them here (instead of
 * importing the plugin modules for their side-effect augmentations)
 * because `verbatimModuleSyntax` elides value-less imports and the
 * admin package should not pull the auth plugin's runtime into routes.
 */
declare module 'fastify' {
  interface FastifyRequest {
    auth?: { sub: string; role: string; jti: string; iat: number };
  }
  interface FastifyInstance {
    admin?: AdminContext;
    verifyAdmin?: (request: FastifyRequest) => Promise<void>;
    authorize?: (
      action: string,
      subject: string,
    ) => (request: FastifyRequest) => Promise<void>;
  }
}

/**
 * Look up the backing repository for a resource. Routes use this via the
 * internal context because the public `AdminResourceSpec` is intentionally
 * stripped of runtime machinery.
 */
export const getRepo = (
  ctx: AdminContext,
  spec: AdminResourceSpec,
): AdminDiscoverable => {
  const repo = ctx.repos.get(spec.name);
  if (!repo) {
    throw new InternalServerErrorException(
      `@kit/admin: no repository registered for resource "${spec.name}"`,
    );
  }
  return repo;
};

const hxHeaderKey = 'hx-request';

export const isHtmxRequest = (request: FastifyRequest): boolean =>
  request.headers[hxHeaderKey] !== undefined;

/**
 * Build a `PageRenderContext` for a full-page render. Walks the registry
 * to produce nav entries and marks the resource matching the current
 * URL as active.
 */
export const buildRenderContext = (
  ctx: AdminContext,
  request: FastifyRequest,
  extra: {
    readonly activeResource?: string;
    readonly flash?: PageRenderContext['flash'];
  } = {},
): PageRenderContext => {
  const { prefix, assetPrefix, title } = ctx.options;
  const auth = request.auth;
  const userId = auth?.sub ?? 'anon';
  const csrfToken = ctx.csrf.issue(userId);

  const nav = ctx.registry.all().map((spec) => ({
    href: `${prefix}/${spec.name}`,
    label: spec.label,
    active: spec.name === extra.activeResource,
  }));

  // The JWT carries only { sub, role }; the layout's "user" block wants an
  // email, so we surface the sub as the user label. Real e-mail display can
  // be wired later by resolving the user via DI.
  const user = auth ? { email: auth.sub, role: auth.role } : undefined;

  const base: PageRenderContext = {
    title,
    assetPrefix,
    csrfToken,
    nav,
    ...(user ? { user } : {}),
    ...(extra.flash ? { flash: extra.flash } : {}),
  };

  return base;
};
