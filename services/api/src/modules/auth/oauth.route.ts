/**
 * OAuth routes (Google + GitHub on day one). Authorization Code + PKCE,
 * signed-JWT state in the URL (no cookie -- sidesteps SameSite issues).
 *
 *   POST   /auth/oauth/:provider/start     -> { authorizeUrl }
 *   GET    /auth/oauth/:provider/callback  -> 302 to returnTo with JWT cookies
 *   POST   /auth/oauth/:provider/link      -> link to authenticated user
 *   DELETE /auth/oauth/:provider           -> unlink
 *
 * The link / unlink flows require an authenticated session. Start +
 * callback are tenant-bypassed (the user might not have a tenant yet).
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { config } from '#config.ts';
import type { UserIdentitiesStore, UserStore } from '@kit/auth';
import {
  deriveCodeChallenge,
  generateCodeVerifier,
  isReturnToAllowed,
  OAuthCannotUnlinkLastIdentity,
  OAuthEmailCollisionRequiresLogin,
  OAuthEmailMissing,
  OAuthProviderNotConfigured,
  OAuthStateVerificationFailed,
  signOAuthState,
  verifyOAuthState,
  type OAuthProfile,
  type OAuthProviderName,
  type OAuthRegistry,
} from '@kit/auth/oauth';
import {
  apiErrorEnvelopeSchema,
  createSuccessResponseSchema,
  ok,
  StringEnum,
} from '@kit/schemas';
import { withTenantBypass } from '@kit/tenancy';

const providerParameter = Type.Object({
  provider: StringEnum(['google', 'github']),
});

const startBody = Type.Object({
  returnTo: Type.Optional(Type.String()),
});

const startResponse = Type.Object({
  authorizeUrl: Type.String(),
});

const callbackQuery = Type.Object({
  code: Type.String(),
  state: Type.String(),
});

const buildRedirectUri = (provider: OAuthProviderName): string => {
  const base = config.OAUTH_REDIRECT_BASE_URL ?? config.APP_URL;
  return `${base.replace(/\/$/, '')}/auth/oauth/${provider}/callback`;
};

const requireProvider = (registry: OAuthRegistry, name: OAuthProviderName) => {
  const provider = registry[name];
  if (!provider) {
    throw new OAuthProviderNotConfigured(
      `OAuth provider "${name}" is not configured. Set ${name.toUpperCase()}_CLIENT_ID and ${name.toUpperCase()}_CLIENT_SECRET.`,
    );
  }
  return provider;
};

const oauthRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.route({
    method: 'POST',
    url: '/oauth/:provider/start',
    ...withTenantBypass({ rateLimit: { max: 30, timeWindow: '1 minute' } }),
    schema: {
      tags: ['auth'],
      params: providerParameter,
      body: startBody,
      response: { 200: createSuccessResponseSchema(startResponse) },
    },
    handler: async (request) => {
      const cradle = fastify.diContainer.cradle as unknown as {
        oauthRegistry: OAuthRegistry;
      };
      const providerName = request.params.provider as OAuthProviderName;
      const provider = requireProvider(cradle.oauthRegistry, providerName);
      const returnTo = request.body.returnTo ?? '/';
      const allowedOrigin = new URL(config.APP_URL).origin;
      if (!isReturnToAllowed(returnTo, { origin: allowedOrigin })) {
        throw new OAuthStateVerificationFailed(
          `returnTo "${returnTo}" is not in the allowlist.`,
        );
      }
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = deriveCodeChallenge(codeVerifier);
      const nonce = generateCodeVerifier().slice(0, 16);
      const state = await signOAuthState(
        { nonce, returnTo, codeVerifier, providerId: providerName },
        config.JWT_SECRET,
      );
      const authorizeUrl = provider.buildAuthorizeUrl({
        state,
        codeChallenge,
        redirectUri: buildRedirectUri(providerName),
        nonce,
      });
      request.audit('auth.oauth-started', {
        type: 'OAuthFlow',
        id: providerName,
      });
      return ok({ authorizeUrl });
    },
  });

  fastify.route({
    method: 'GET',
    url: '/oauth/:provider/callback',
    ...withTenantBypass({ rateLimit: { max: 30, timeWindow: '1 minute' } }),
    schema: {
      tags: ['auth'],
      params: providerParameter,
      querystring: callbackQuery,
      response: { 400: apiErrorEnvelopeSchema },
    },
    handler: async (request, reply) => {
      const cradle = fastify.diContainer.cradle as unknown as {
        oauthRegistry: OAuthRegistry;
      };
      const providerName = request.params.provider as OAuthProviderName;
      const provider = requireProvider(cradle.oauthRegistry, providerName);
      const claims = await verifyOAuthState(
        request.query.state,
        config.JWT_SECRET,
      );
      if (!claims || claims.providerId !== providerName) {
        throw new OAuthStateVerificationFailed();
      }
      const tokens = await provider.exchangeCode({
        code: request.query.code,
        codeVerifier: claims.codeVerifier,
        redirectUri: buildRedirectUri(providerName),
      });
      const profile = await provider.fetchProfile(
        tokens.accessToken,
        tokens.idToken,
      );
      const result = await handleOAuthCallback({
        fastify,
        provider: providerName,
        profile,
        linkUserId: claims.linkUserId ?? null,
      });
      request.audit('auth.oauth-completed', {
        type: 'OAuthFlow',
        id: providerName,
      });
      // Redirect with tokens passed via fragment (avoids logging in
      // server access logs as query params). Production deployments
      // typically swap this for a session-cookie strategy.
      const redirectUrl = `${claims.returnTo}#access_token=${encodeURIComponent(result.accessToken)}&refresh_token=${encodeURIComponent(result.refreshToken)}`;
      return reply.redirect(redirectUrl);
    },
  });

  fastify.route({
    method: 'POST',
    url: '/oauth/:provider/link',
    onRequest: [fastify.verifyUser],
    schema: {
      tags: ['auth'],
      params: providerParameter,
      body: startBody,
      response: { 200: createSuccessResponseSchema(startResponse) },
    },
    handler: async (request) => {
      const cradle = fastify.diContainer.cradle as unknown as {
        oauthRegistry: OAuthRegistry;
      };
      const providerName = request.params.provider as OAuthProviderName;
      const provider = requireProvider(cradle.oauthRegistry, providerName);
      const returnTo = request.body.returnTo ?? '/';
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = deriveCodeChallenge(codeVerifier);
      const nonce = generateCodeVerifier().slice(0, 16);
      const state = await signOAuthState(
        {
          nonce,
          returnTo,
          codeVerifier,
          providerId: providerName,
          linkUserId: request.auth?.sub ?? '',
        },
        config.JWT_SECRET,
      );
      const authorizeUrl = provider.buildAuthorizeUrl({
        state,
        codeChallenge,
        redirectUri: buildRedirectUri(providerName),
        nonce,
      });
      return ok({ authorizeUrl });
    },
  });

  fastify.route({
    method: 'DELETE',
    url: '/oauth/:provider',
    onRequest: [fastify.verifyUser],
    schema: {
      tags: ['auth'],
      params: providerParameter,
      response: { 204: Type.Null(), 422: apiErrorEnvelopeSchema },
    },
    handler: async (request, reply) => {
      const cradle = fastify.diContainer.cradle as unknown as {
        userIdentitiesRepository: UserIdentitiesStore;
        userStore: UserStore;
      };
      const userId = request.auth?.sub;
      if (!userId) {
        // Defensive guard -- verifyUser already runs above. Cast 401
        // through `unknown` because the route schema only declares 204
        // / 422 responses (verifyUser surfaces 401 through the global
        // error handler, not through the typed reply).
        return reply.status(401 as unknown as 204).send(null);
      }
      const identities =
        await cradle.userIdentitiesRepository.findByUserId(userId);
      const target = identities.find(
        (index) => index.provider === request.params.provider,
      );
      if (!target) {
        return reply.status(204).send(null);
      }
      // Refuse if this is the only login method (no password, single
      // identity). The user would lock themselves out otherwise.
      const user = await cradle.userStore.findById(userId);
      if (
        identities.length === 1 &&
        (!user || user.passwordHash === '' || user.passwordHash === null)
      ) {
        throw new OAuthCannotUnlinkLastIdentity();
      }
      await cradle.userIdentitiesRepository.delete(target.id);
      request.audit('auth.oauth-unlinked', {
        type: 'OAuthIdentity',
        id: target.id,
      });
      return reply.status(204).send(null);
    },
  });

  // Touch all error classes so the bundler doesn't tree-shake them
  // before the global error handler can recognise them.
  void OAuthEmailCollisionRequiresLogin;
  void OAuthEmailMissing;
};

interface OAuthCallbackInput {
  fastify: FastifyInstance;
  provider: OAuthProviderName;
  profile: OAuthProfile;
  linkUserId: string | null;
}

interface AuthResult {
  accessToken: string;
  refreshToken: string;
}

interface AccessTokenInput {
  sub: string;
  role: string;
  email?: string;
}

interface RefreshTokenInput {
  sub: string;
}

interface OAuthCallbackTokenService {
  signAccessToken(input: AccessTokenInput): Promise<string>;
  signRefreshToken(input: RefreshTokenInput): Promise<string>;
}

interface OAuthCallbackCradle {
  userIdentitiesRepository: UserIdentitiesStore;
  userStore: UserStore;
  tokenService: OAuthCallbackTokenService;
}

const handleOAuthCallback = async (
  input: OAuthCallbackInput,
): Promise<AuthResult> => {
  const cradle = input.fastify.diContainer
    .cradle as unknown as OAuthCallbackCradle;

  // 1. Existing identity hits the happy path.
  const existing = await cradle.userIdentitiesRepository.findByProviderUserId(
    input.provider,
    input.profile.providerUserId,
  );
  if (existing) {
    const user = await cradle.userStore.findById(existing.userId);
    if (!user) {
      throw new OAuthEmailMissing(input.provider);
    }
    return await issueTokens(cradle, user);
  }

  // 2. Explicit link flow: state carried `linkUserId`.
  if (input.linkUserId) {
    const user = await cradle.userStore.findById(input.linkUserId);
    if (!user) throw new OAuthEmailMissing(input.provider);
    await cradle.userIdentitiesRepository.create({
      userId: input.linkUserId,
      provider: input.provider,
      providerUserId: input.profile.providerUserId,
      email: input.profile.email,
      emailVerified: input.profile.emailVerified,
      rawProfile: input.profile.raw,
    });
    return await issueTokens(cradle, user);
  }

  // 3. New identity: check for email collision.
  if (input.profile.email) {
    const colliding = await cradle.userStore.findByEmail(input.profile.email);
    if (colliding) {
      const canAutoLink =
        input.profile.emailVerified && colliding.emailVerifiedAt !== null;
      if (!canAutoLink) {
        throw new OAuthEmailCollisionRequiresLogin(input.profile.email);
      }
      await cradle.userIdentitiesRepository.create({
        userId: colliding.id,
        provider: input.provider,
        providerUserId: input.profile.providerUserId,
        email: input.profile.email,
        emailVerified: true,
        rawProfile: input.profile.raw,
      });
      return await issueTokens(cradle, colliding);
    }
  }

  // 4. Apple-style re-grant with no email and no existing identity ->
  //    explicit failure so the user is told to revoke + reauthorize.
  if (!input.profile.email) {
    throw new OAuthEmailMissing(input.provider);
  }

  // 5. Brand-new user. Reuse the registration path so a personal tenant
  //    + owner membership are minted in one transaction.
  // NOTE: requires an authService.registerOAuth(...) extension or a
  // dedicated path -- v1 throws for now; consumers can wire the
  // existing register flow with a placeholder password if they need the
  // signup branch active before the auth-service extension lands.
  throw new OAuthEmailMissing(input.provider);
};

interface IssueTokensCradle {
  tokenService: OAuthCallbackTokenService;
}

interface IssueTokensUser {
  id: string;
  role: string;
  email: string;
}

const issueTokens = async (
  cradle: IssueTokensCradle,
  user: IssueTokensUser,
): Promise<AuthResult> => {
  const [accessToken, refreshToken] = await Promise.all([
    cradle.tokenService.signAccessToken({
      sub: user.id,
      role: user.role,
      email: user.email,
    }),
    cradle.tokenService.signRefreshToken({ sub: user.id }),
  ]);
  return { accessToken, refreshToken };
};

export default oauthRoute;
export const autoPrefix = '/auth';
