import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify';
import fp from 'fastify-plugin';

import type { TenantContext, TenantStorage } from './context.js';
import { MembershipRequired, TenantNotResolved } from './errors.js';
import type { TenantResolver } from './resolvers.js';

const BYPASS = 'bypass' as const;

interface TenancyCradle {
  tenantStorage: TenantStorage;
  tenantContext: TenantContext;
}

interface FastifyWithDi extends FastifyInstance {
  diContainer: { cradle: TenancyCradle };
}

export interface Tenant {
  readonly tenantId: string;
}

export interface RequestMembership {
  readonly tenantId: string;
  readonly role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Active tenant for this request (set by `createTenancyPlugin`). */
    tenant?: Tenant;
    /**
     * Membership of the authenticated user in `request.tenant`. Populated
     * by `createTenancyPlugin` when `resolveMembership` is wired. Read by
     * `@kit/authz`'s ability builder.
     */
    membership?: RequestMembership;
  }
  interface FastifyInstance {
    /**
     * Open a tenant frame outside the request lifecycle (jobs, CLI, tests).
     * Mirrors `tenantContext.withTenant`.
     */
    withTenant: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T>;
    /** Read the active tenant or throw `TenantNotResolved`. */
    currentTenant: () => Tenant;
  }
  interface FastifyContextConfig {
    /**
     * Mark a route to skip tenant resolution. Useful for signup, public
     * health checks, and other pre-tenant routes.
     */
    tenant?: typeof BYPASS;
  }
}

/**
 * Spread into a Fastify route definition to bypass tenant resolution.
 * When a route already has a `config` block, pass it as the first argument
 * to merge -- the helper otherwise replaces existing config keys.
 *
 * @example
 * fastify.route({
 *   method: 'POST',
 *   url: '/auth/register',
 *   ...withTenantBypass({ rateLimit: { max: 5 } }),
 *   handler,
 * });
 */
export const withTenantBypass = <C extends Record<string, unknown>>(
  existingConfig?: C,
): { config: C & { tenant: typeof BYPASS } } => ({
  config: {
    ...(existingConfig ?? ({} as C)),
    tenant: BYPASS,
  } as C & { tenant: typeof BYPASS },
});

export interface ResolveMembershipParams {
  readonly tenantId: string;
  readonly userId: string;
}

export type ResolveMembershipFn = (
  params: ResolveMembershipParams,
) => Promise<RequestMembership | null>;

export interface TenancyPluginOptions {
  /** Resolver chain executed in declaration order; first non-null wins. */
  readonly resolverOrder: readonly TenantResolver[];
  /**
   * Verifies the resolved tenant id corresponds to a real membership of
   * the authenticated user, **strongly recommended** when any resolver
   * in the chain reads from a client-controlled source (header, cookie,
   * subdomain, JWT claim). Returning `null` -> 403 `MembershipRequired`.
   *
   * The hook fires only when `request.auth?.sub` (or whatever your auth
   * plugin populates as the user id) is present. Pre-auth requests skip
   * the check entirely -- guard those routes with `withTenantBypass()`
   * if they don't need a tenant frame at all.
   */
  readonly resolveMembership?: ResolveMembershipFn;
  /**
   * Override how the authenticated user's id is read off the request.
   * Defaults to `request.auth?.sub`, matching `@kit/auth`'s
   * AccessTokenPayload.
   */
  readonly getUserId?: (request: FastifyRequest) => string | null;
  /** Override how `TenantStorage` is fetched (defaults to DI cradle). */
  readonly resolveTenantStorage?: (fastify: FastifyInstance) => TenantStorage;
  /** Override how `TenantContext` is fetched (defaults to DI cradle). */
  readonly resolveTenantContext?: (fastify: FastifyInstance) => TenantContext;
}

const runChain = async (
  resolvers: readonly TenantResolver[],
  request: FastifyRequest,
): Promise<string | null> => {
  for (const resolver of resolvers) {
    const result = await resolver(request);
    if (result) return result;
  }
  return null;
};

const defaultGetUserId = (request: FastifyRequest): string | null => {
  const auth = (request as { auth?: { sub?: unknown } }).auth;
  return typeof auth?.sub === 'string' ? auth.sub : null;
};

const tenancyPlugin: FastifyPluginAsync<TenancyPluginOptions> = async (
  fastify,
  opts,
) => {
  const resolveStorage =
    opts.resolveTenantStorage ??
    ((f: FastifyInstance) =>
      (f as FastifyWithDi).diContainer.cradle.tenantStorage);
  const resolveContext =
    opts.resolveTenantContext ??
    ((f: FastifyInstance) =>
      (f as FastifyWithDi).diContainer.cradle.tenantContext);

  const tenantStorage = resolveStorage(fastify);
  const tenantContext = resolveContext(fastify);
  const getUserId = opts.getUserId ?? defaultGetUserId;

  if (!opts.resolveMembership) {
    fastify.log.warn(
      '@kit/tenancy: resolveMembership not configured. Header / cookie / ' +
        'JWT-claim resolvers accept any client-supplied tenant id without ' +
        'verifying membership -- a leaked or forged value can cross tenant ' +
        'boundaries on writes.',
    );
  }

  fastify.decorateRequest('tenant');
  // `membership` may already be decorated by `@kit/authz` (which owns
  // the typing for ability resolution). Skip when present so plugin
  // ordering between authz and tenancy stays interchangeable.
  if (!fastify.hasRequestDecorator('membership')) {
    fastify.decorateRequest('membership');
  }

  fastify.decorate('withTenant', tenantContext.withTenant);
  fastify.decorate('currentTenant', () => ({
    tenantId: tenantContext.currentTenant().tenantId,
  }));

  // Tenant resolution is split across two hooks:
  //   - onRequest (async): runs the resolver chain + optional membership
  //     check. Sets `request.tenant` and `request.membership` so any
  //     auth/authz hook scheduled after tenancy can read them.
  //   - preHandler (callback): opens the AsyncLocalStorage frame.
  //
  // Why two hooks? `tenantStorage.enterWith` from inside an async
  // onRequest does NOT reliably propagate to the route handler under
  // Fastify v5's promise-based hook scheduler. The callback-style
  // `tenantStorage.run({...}, () => done())` keeps Fastify's
  // continuation INSIDE the frame, which is the only pattern that
  // survives end-to-end. The ALS frame becomes available the moment
  // the handler runs; pre-handler hooks reading `request.tenant` work
  // either way.
  fastify.addHook('onRequest', async (request) => {
    if (request.routeOptions.config?.tenant === BYPASS) return;

    const tenantId = await runChain(opts.resolverOrder, request);
    if (!tenantId) throw new TenantNotResolved();

    if (opts.resolveMembership) {
      const userId = getUserId(request);
      if (userId) {
        const membership = await opts.resolveMembership({ tenantId, userId });
        if (!membership) throw new MembershipRequired(tenantId);
        request.membership = membership;
      }
    }

    request.tenant = { tenantId };
  });

  fastify.addHook(
    'preHandler',
    (
      request: FastifyRequest,
      _reply: FastifyReply,
      done: HookHandlerDoneFunction,
    ) => {
      if (request.routeOptions.config?.tenant === BYPASS) {
        done();
        return;
      }
      const tenant = request.tenant;
      if (!tenant) {
        done(new TenantNotResolved());
        return;
      }
      tenantStorage.run({ tenantId: tenant.tenantId }, () => done());
    },
  );
};

export const createTenancyPlugin = fp(tenancyPlugin, {
  name: '@kit/tenancy',
  dependencies: ['@fastify/awilix'],
});

export default createTenancyPlugin;
