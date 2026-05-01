/**
 * Cookie-backed tenant switcher for admin users with multiple memberships.
 *
 * - `GET  /_tenants`        -- list the current user's memberships and
 *                              render a clickable switcher panel.
 * - `POST /_tenants/select` -- set the `__Host-admin_tenant` cookie and
 *                              redirect back to the dashboard.
 *
 * Both routes mark `config.tenant: 'bypass'` so a logged-in user without
 * a tenant frame can still reach them. Pair this with the `fromCookie`
 * resolver from `@kit/tenancy/resolvers` (cookie name `admin_tenant` --
 * the `__Host-` prefix is added on the wire).
 *
 * The route looks up `membershipsRepository` and `tenantsRepository` by
 * cradle key so admin does not take a runtime import dependency on
 * `@kit/tenancy`. Consumers that don't register tenancy still get the
 * switcher (it just renders an empty list).
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { html } from 'htm/preact';
import type { VNode } from 'preact';

import { BadRequestException, ForbiddenException } from '@kit/errors';

import { safeUrl } from '../safe-url.js';

import {
  assertAdminContext,
  extractCsrf,
  respondHtml,
  type RawBody,
} from './_helpers.js';

const TENANT_COOKIE = '__Host-admin_tenant';
const TENANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 days
const BYPASS_CONFIG = { tenant: 'bypass' as const };

interface MembershipRow {
  readonly tenantId: string;
  readonly role: string;
}

interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

interface MembershipsRepoShape {
  findAllForUser(userId: string): Promise<readonly MembershipRow[]>;
}

interface TenantsRepoShape {
  findById(id: string): Promise<TenantRow | undefined>;
}

const isMembershipsRepo = (v: unknown): v is MembershipsRepoShape =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { findAllForUser?: unknown }).findAllForUser === 'function';

const isTenantsRepo = (v: unknown): v is TenantsRepoShape =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { findById?: unknown }).findById === 'function';

const setTenantCookie = (reply: FastifyReply, tenantId: string): void => {
  const replyWithCookie = reply as FastifyReply & {
    setCookie?: (
      n: string,
      v: string,
      o: Record<string, unknown>,
    ) => FastifyReply;
  };
  if (typeof replyWithCookie.setCookie === 'function') {
    replyWithCookie.setCookie(TENANT_COOKIE, tenantId, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: TENANT_COOKIE_MAX_AGE,
    });
    return;
  }
  reply.header(
    'set-cookie',
    `${TENANT_COOKIE}=${tenantId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TENANT_COOKIE_MAX_AGE}`,
  );
};

interface SwitcherEntry {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly role: string;
  readonly current: boolean;
}

const renderSwitcher = (
  prefix: string,
  csrfToken: string,
  entries: readonly SwitcherEntry[],
): VNode => {
  const action = safeUrl(`${prefix}/_tenants/select`);
  if (entries.length === 0) {
    return html`<section class="admin-tenants">
      <h1>Pick a tenant</h1>
      <p class="muted">
        You are not a member of any tenant yet. Ask an existing tenant owner to
        invite you.
      </p>
    </section>`;
  }
  return html`<section class="admin-tenants">
    <h1>Pick a tenant</h1>
    <ul class="admin-tenants__list">
      ${entries.map(
        (entry) =>
          html`<li
            class=${entry.current
              ? 'admin-tenants__item admin-tenants__item--current'
              : 'admin-tenants__item'}
          >
            <form method="post" action=${action} class="admin-tenants__form">
              <input type="hidden" name="_csrf" value=${csrfToken} />
              <input type="hidden" name="tenantId" value=${entry.tenantId} />
              <button type="submit" class="btn btn-primary">
                <span class="admin-tenants__name">${entry.tenantName}</span>
                <span class="admin-tenants__slug muted">
                  ${entry.tenantSlug}
                </span>
                <span class="admin-tenants__role muted">${entry.role}</span>
              </button>
            </form>
          </li>`,
      )}
    </ul>
  </section>`;
};

/**
 * Awilix's cradle proxy throws on `get` for an unregistered key, so
 * use `Object.keys` to check first. Plain-object cradles (test fixtures
 * + the no-Awilix path) work the same way.
 */
const safeCradleGet = <T>(
  cradle: Record<string, unknown>,
  key: string,
  guard: (value: unknown) => value is T,
): T | null => {
  if (!Object.keys(cradle).includes(key)) return null;
  try {
    const value = cradle[key];
    return guard(value) ? value : null;
  } catch {
    return null;
  }
};

export const tenantsSwitcherRoute: FastifyPluginAsync = async (fastify) => {
  const getRepos = (): {
    memberships: MembershipsRepoShape | null;
    tenants: TenantsRepoShape | null;
  } => {
    const cradle =
      (
        fastify as typeof fastify & {
          diContainer?: { cradle?: Record<string, unknown> };
        }
      ).diContainer?.cradle ?? {};
    return {
      memberships: safeCradleGet(
        cradle,
        'membershipsRepository',
        isMembershipsRepo,
      ),
      tenants: safeCradleGet(cradle, 'tenantsRepository', isTenantsRepo),
    };
  };

  const buildEntries = async (
    userId: string,
    currentTenantId: string | null,
  ): Promise<readonly SwitcherEntry[]> => {
    const { memberships, tenants } = getRepos();
    if (!memberships || !tenants) return [];
    const rows = await memberships.findAllForUser(userId);
    const out: SwitcherEntry[] = [];
    for (const row of rows) {
      const tenant = await tenants.findById(row.tenantId);
      if (!tenant) continue;
      out.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        role: row.role,
        current: tenant.id === currentTenantId,
      });
    }
    return out;
  };

  fastify.get(
    '/_tenants',
    { config: BYPASS_CONFIG },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);
      const auth = request.auth;
      const userId = auth?.sub ?? '';
      const currentTenantId =
        (request as FastifyRequest & { tenant?: { tenantId: string } }).tenant
          ?.tenantId ?? null;
      const entries =
        userId.length > 0 ? await buildEntries(userId, currentTenantId) : [];
      const csrfToken = ctx.csrf.issue(userId.length > 0 ? userId : 'anon');
      const body = renderSwitcher(ctx.options.prefix, csrfToken, entries);
      return respondHtml(reply, request, ctx, body);
    },
  );

  fastify.post(
    '/_tenants/select',
    { config: BYPASS_CONFIG },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);
      const auth = request.auth;
      const userId = auth?.sub ?? '';
      if (userId.length === 0) {
        throw new ForbiddenException('Sign in before picking a tenant');
      }

      const body = (request.body ?? {}) as RawBody;
      const csrf = extractCsrf(body);
      if (!ctx.csrf.verify(csrf, userId)) {
        throw new ForbiddenException('Invalid CSRF token');
      }

      const tenantId =
        typeof body['tenantId'] === 'string' ? body['tenantId'].trim() : '';
      if (tenantId.length === 0) {
        throw new BadRequestException('Missing tenantId');
      }

      const { memberships } = getRepos();
      if (memberships) {
        const rows = await memberships.findAllForUser(userId);
        const allowed = rows.some((m) => m.tenantId === tenantId);
        if (!allowed) {
          throw new ForbiddenException(
            'You are not a member of the requested tenant',
          );
        }
      }

      setTenantCookie(reply, tenantId);
      reply.redirect(safeUrl(`${ctx.options.prefix}/`));
      return reply;
    },
  );
};

export default tenantsSwitcherRoute;
