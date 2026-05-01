import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';

import type {
  AbilityFactory,
  AppAbility,
  AuthzAction,
  AuthzMembership,
  AuthzSubject,
  AuthzUser,
} from './ability.js';
import { ForbiddenError, UnauthorizedError } from './errors.js';

interface AuthzCradle {
  abilityFactory: AbilityFactory;
}

interface FastifyWithDi extends FastifyInstance {
  diContainer: { cradle: AuthzCradle };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Per-request CASL ability, populated lazily on first `authorize` call. */
    ability?: AppAbility;
    /**
     * Optional active membership the consumer populates before any
     * `authorize` hook runs (typically in a preHandler that reads
     * `request.tenant` + `request.auth` and looks up the row from
     * `membershipsRepository`). Module definers see this via the third
     * argument to `DefineAbilities`.
     */
    membership?: AuthzMembership;
  }
  interface FastifyInstance {
    /**
     * Returns a preHandler hook that throws `ForbiddenError` when the caller
     * lacks the requested permission. The optional `getSubject` resolver
     * lets you check field-level rules (e.g. ownership) by loading the
     * record before the rule runs.
     */
    authorize: (
      action: AuthzAction,
      subject: AuthzSubject | string,
      getSubject?: (
        request: FastifyRequest,
      ) => Promise<AuthzSubject> | AuthzSubject,
    ) => preHandlerHookHandler;
  }
}

export interface AuthzPluginOptions {
  /**
   * Override how the per-request ability factory is resolved. Defaults to
   * `fastify.diContainer.cradle.abilityFactory`, matching the kit
   * convention.
   */
  resolveAbilityFactory?: (fastify: FastifyInstance) => AbilityFactory;
  /**
   * Override how the caller is read off the request. Defaults to
   * `request.auth` (populated by `@kit/auth`'s `verifyJwt` decorator).
   */
  getUser?: (request: FastifyRequest) => AuthzUser | undefined;
  /**
   * Override how the active membership is read off the request. Defaults to
   * `request.membership` (populated by a consumer-owned preHandler that
   * reads `request.tenant` + `request.auth` and looks up the membership
   * row). Single-tenant apps typically leave this `undefined`.
   */
  getMembership?: (
    request: FastifyRequest,
  ) => Promise<AuthzMembership | undefined> | AuthzMembership | undefined;
}

const defaultGetUser = (request: FastifyRequest): AuthzUser | undefined => {
  const auth = (
    request as FastifyRequest & { auth?: { sub: string; role: string } }
  ).auth;
  if (!auth) return undefined;
  return { id: auth.sub, role: auth.role };
};

const defaultGetMembership = (
  request: FastifyRequest,
): AuthzMembership | undefined => request.membership;

const authzPlugin: FastifyPluginAsync<AuthzPluginOptions> = async (
  fastify,
  opts,
) => {
  const resolveFactory =
    opts.resolveAbilityFactory ??
    ((f: FastifyInstance) =>
      (f as FastifyWithDi).diContainer.cradle.abilityFactory);
  const getUser = opts.getUser ?? defaultGetUser;
  const getMembership = opts.getMembership ?? defaultGetMembership;

  fastify.decorateRequest('ability');
  fastify.decorateRequest('membership');

  fastify.decorate('authorize', function (action, subject, getSubject) {
    return async function authorizeHook(request: FastifyRequest) {
      const user = getUser(request);
      // No user => either auth wasn't run or token was missing. We treat it
      // as 401 rather than 403 because "log in first" is a more useful hint
      // than "you can't do this". Pair `authorize` with `verifyUser` on the
      // route to make this branch unreachable in normal flows.
      if (!user) throw new UnauthorizedError();

      if (!request.ability) {
        const factory = resolveFactory(fastify);
        const membership = await getMembership(request);
        request.ability = factory.buildFor(user, membership);
      }

      const target = getSubject
        ? await getSubject(request)
        : (subject as AuthzSubject);
      if (!request.ability.can(action, target)) {
        throw new ForbiddenError(
          `Not allowed to ${action} ${typeof subject === 'string' ? subject : 'resource'}`,
        );
      }
    };
  });
};

export const createAuthzPlugin = fp(authzPlugin, {
  name: '@kit/authz',
  dependencies: ['@fastify/awilix'],
});

export default createAuthzPlugin;
