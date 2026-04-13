import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';

import {
  ForbiddenError,
  TokenRevokedError,
  UnauthorizedError,
} from './errors.js';
import type { TokenBlacklistStore } from './stores.js';
import type { AccessTokenPayload, TokenService } from './tokens.js';

interface AuthCradle {
  tokenService: TokenService;
  tokenBlacklistStore: TokenBlacklistStore;
}

interface FastifyWithDi extends FastifyInstance {
  diContainer: { cradle: AuthCradle };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AccessTokenPayload;
  }
  interface FastifyInstance {
    verifyJwt: (request: FastifyRequest) => Promise<void>;
    verifyUser: (request: FastifyRequest) => Promise<void>;
    verifyAdmin: (request: FastifyRequest) => Promise<void>;
  }
}

export interface AuthPluginOptions {
  resolveTokenService?: (fastify: FastifyInstance) => TokenService;
  resolveBlacklistStore?: (fastify: FastifyInstance) => TokenBlacklistStore;
}

const extractBearer = (header: string | undefined): string => {
  if (!header) throw new UnauthorizedError('Missing Authorization header');
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new UnauthorizedError('Invalid Authorization header');
  }
  return token;
};

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (
  fastify,
  opts,
) => {
  const resolveToken =
    opts.resolveTokenService ??
    ((f: FastifyInstance) =>
      (f as FastifyWithDi).diContainer.cradle.tokenService);

  const resolveBlacklist =
    opts.resolveBlacklistStore ??
    ((f: FastifyInstance) =>
      (f as FastifyWithDi).diContainer.cradle.tokenBlacklistStore);

  fastify.decorateRequest('auth');

  fastify.decorate('verifyJwt', async function (request: FastifyRequest) {
    const tokenService = resolveToken(fastify);
    const blacklistStore = resolveBlacklist(fastify);
    const token = extractBearer(request.headers.authorization);

    try {
      const payload = await tokenService.verifyAccessToken(token);

      // Check Redis blacklist: individual token + user-wide clear-sessions
      const [blacklisted, clearedAt] = await Promise.all([
        blacklistStore.isBlacklisted(payload.jti),
        blacklistStore.getClearedAt(payload.sub),
      ]);

      if (blacklisted) throw new TokenRevokedError();
      if (clearedAt !== null && payload.iat < clearedAt) {
        throw new TokenRevokedError('All sessions cleared');
      }

      request.auth = payload;
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) throw error;
      throw new UnauthorizedError();
    }
  });

  fastify.decorate('verifyUser', async function (request: FastifyRequest) {
    await fastify.verifyJwt(request);
    if (!request.auth) throw new UnauthorizedError();
  });

  fastify.decorate('verifyAdmin', async function (request: FastifyRequest) {
    await fastify.verifyJwt(request);
    if (request.auth?.role !== 'admin') throw new ForbiddenError();
  });
};

export const createAuthPlugin = fp(authPlugin, {
  name: '@kit/auth',
  dependencies: ['@fastify/awilix'],
});

export default createAuthPlugin;
