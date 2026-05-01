/**
 * Admin login / logout routes.
 *
 * - `GET  /login`  -- render a plain HTML form (no htmx).
 * - `POST /login`  -- authenticate via `authService.login`, set two
 *                     cookies (`__Host-admin_session` + refresh), redirect
 *                     to the dashboard.
 * - `POST /logout` -- clear cookies, best-effort `authService.logout`.
 *
 * Cookies:
 *   - `__Host-admin_session` holds the access token (15 min).
 *   - `__Host-admin_refresh` holds the refresh token (14 days).
 *
 * CSRF is not enforced on login itself; the form merely passes a token
 * for forward-compat. Post-login every HTML form includes a hidden
 * `_csrf` field which `csrf.verify` checks against the authenticated
 * user id.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { html } from 'htm/preact';
import type { VNode } from 'preact';

import { InternalServerErrorException } from '@kit/errors';

import { renderPage } from '../render.js';
import { safeUrl } from '../safe-url.js';

import { assertAdminContext } from './_helpers.js';

const ACCESS_COOKIE = '__Host-admin_session';
const REFRESH_COOKIE = '__Host-admin_refresh';
const ACCESS_MAX_AGE = 900; // 15 min
const REFRESH_MAX_AGE = 1_209_600; // 14 days

// Public auth routes never have a tenant frame; mark them so a consumer's
// `@kit/tenancy` plugin skips resolution instead of throwing 400 here.
const BYPASS_CONFIG = { tenant: 'bypass' as const };

interface LoginBody {
  readonly email?: unknown;
  readonly password?: unknown;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthUser {
  id: string;
  email: string;
  role: string;
}

interface LoginResult {
  tokens: AuthTokens;
  user: AuthUser;
}

interface AuthServiceShape {
  login(input: { email: string; password: string }): Promise<LoginResult>;
  logout(refreshToken: string): Promise<void>;
}

const isString = (v: unknown): v is string => typeof v === 'string';

const renderLoginPage = (
  prefix: string,
  assetPrefix: string,
  title: string,
  message: string | null,
): string => {
  const csrfToken = 'login';
  const body: VNode = html`<section class="admin-login">
    <h1>Sign in</h1>
    ${message
      ? html`<p class="admin-flash admin-flash--error">${message}</p>`
      : null}
    <form method="post" action=${safeUrl(`${prefix}/login`)} class="admin-form">
      <input type="hidden" name="_csrf" value=${csrfToken} />
      <div class="form-row">
        <label class="form-label" for="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          class="form-input"
          required
          autocomplete="username"
        />
      </div>
      <div class="form-row">
        <label class="form-label" for="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          class="form-input"
          required
          autocomplete="current-password"
        />
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">Sign in</button>
      </div>
    </form>
  </section>`;

  return renderPage(
    {
      title,
      assetPrefix,
      csrfToken,
      nav: [],
    },
    body,
  );
};

const setCookie = (
  reply: FastifyReply,
  name: string,
  value: string,
  opts: { readonly path: string; readonly maxAge: number },
): void => {
  // Use `@fastify/cookie`'s `setCookie` if it's registered; fall back to
  // writing the Set-Cookie header manually for environments without the
  // plugin (e.g. unit tests).
  const replyWithCookie = reply as FastifyReply & {
    setCookie?: (
      n: string,
      v: string,
      o: Record<string, unknown>,
    ) => FastifyReply;
  };
  if (typeof replyWithCookie.setCookie === 'function') {
    replyWithCookie.setCookie(name, value, {
      path: opts.path,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: opts.maxAge,
    });
    return;
  }
  reply.header(
    'set-cookie',
    `${name}=${value}; Path=${opts.path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${opts.maxAge}`,
  );
};

const clearCookie = (reply: FastifyReply, name: string, path: string): void => {
  const replyWithCookie = reply as FastifyReply & {
    clearCookie?: (n: string, o: Record<string, unknown>) => FastifyReply;
  };
  if (typeof replyWithCookie.clearCookie === 'function') {
    replyWithCookie.clearCookie(name, { path });
    return;
  }
  reply.header(
    'set-cookie',
    `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
};

export const loginRoute: FastifyPluginAsync = async (fastify) => {
  const getAuthService = (): AuthServiceShape => {
    const f = fastify as typeof fastify & {
      diContainer?: { cradle?: Record<string, unknown> };
    };
    const service = f.diContainer?.cradle?.['authService'] as
      | AuthServiceShape
      | undefined;
    if (!service) {
      throw new InternalServerErrorException(
        '@kit/admin: authService missing from DI cradle',
      );
    }
    return service;
  };

  fastify.get(
    '/login',
    { config: BYPASS_CONFIG },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);
      reply.type('text/html; charset=utf-8');
      return renderLoginPage(
        ctx.options.prefix,
        ctx.options.assetPrefix,
        ctx.options.title,
        null,
      );
    },
  );

  fastify.post(
    '/login',
    { config: BYPASS_CONFIG },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);

      const body = (request.body ?? {}) as LoginBody;
      const email = isString(body.email) ? body.email : '';
      const password = isString(body.password) ? body.password : '';

      if (email.length === 0 || password.length === 0) {
        reply.status(400).type('text/html; charset=utf-8');
        return renderLoginPage(
          ctx.options.prefix,
          ctx.options.assetPrefix,
          ctx.options.title,
          'Email and password are required.',
        );
      }

      try {
        const result = await getAuthService().login({ email, password });
        if (result.user.role !== 'admin') {
          reply.status(403).type('text/html; charset=utf-8');
          return renderLoginPage(
            ctx.options.prefix,
            ctx.options.assetPrefix,
            ctx.options.title,
            'Account does not have admin access.',
          );
        }
        setCookie(reply, ACCESS_COOKIE, result.tokens.accessToken, {
          path: '/',
          maxAge: ACCESS_MAX_AGE,
        });
        setCookie(reply, REFRESH_COOKIE, result.tokens.refreshToken, {
          path: ctx.options.prefix,
          maxAge: REFRESH_MAX_AGE,
        });
        reply.redirect(safeUrl(`${ctx.options.prefix}/`));
        return reply;
      } catch {
        reply.status(401).type('text/html; charset=utf-8');
        return renderLoginPage(
          ctx.options.prefix,
          ctx.options.assetPrefix,
          ctx.options.title,
          'Invalid email or password.',
        );
      }
    },
  );

  fastify.post(
    '/logout',
    { config: BYPASS_CONFIG },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);

      const cookies =
        (request as FastifyRequest & { cookies?: Record<string, string> })
          .cookies ?? {};
      const refresh = cookies[REFRESH_COOKIE];
      if (refresh) {
        try {
          await getAuthService().logout(refresh);
        } catch {
          // Best-effort: invalid tokens should not block sign-out.
        }
      }
      clearCookie(reply, ACCESS_COOKIE, '/');
      clearCookie(reply, REFRESH_COOKIE, ctx.options.prefix);
      reply.redirect(safeUrl(`${ctx.options.prefix}/login`));
      return reply;
    },
  );
};

export default loginRoute;
