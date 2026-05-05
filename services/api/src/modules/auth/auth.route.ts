import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import {
  AuthResultSchema,
  EmailVerificationConfirmBodySchema,
  LoginBodySchema,
  LogoutBodySchema,
  OtpRequestBodySchema,
  OtpVerifyBodySchema,
  PasswordResetConfirmBodySchema,
  PasswordResetRequestBodySchema,
  RefreshBodySchema,
  RefreshResultSchema,
  RegisterBodySchema,
} from '@kit/auth/schemas';
import {
  apiErrorEnvelopeSchema,
  createSuccessResponseSchema,
  ok,
} from '@kit/schemas';

const NULL_RESPONSE = { type: 'null' as const };

const authRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  const { authService } = fastify.diContainer.cradle;

  // POST /auth/register -- runs before any tenant exists for this user.
  fastify.route({
    method: 'POST',
    url: '/register',
    config: {
      tenant: 'bypass',
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['auth'],
      body: RegisterBodySchema,
      response: {
        201: createSuccessResponseSchema(AuthResultSchema),
        409: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request, reply) => {
      const result = await authService.register(request.body);
      request.audit(
        'auth.register',
        { type: 'User', id: result.user.id },
        { after: { email: result.user.email, role: result.user.role } },
      );
      return reply.status(201).send(ok(result));
    },
  });

  // POST /auth/login
  fastify.route({
    method: 'POST',
    url: '/login',
    config: {
      tenant: 'bypass',
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['auth'],
      body: LoginBodySchema,
      response: {
        200: createSuccessResponseSchema(AuthResultSchema),
        401: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request) => {
      try {
        const result = await authService.login(request.body);
        request.audit('auth.login', {
          type: 'User',
          id: result.user.id,
        });
        return ok(result);
      } catch (error) {
        // Audit failed login attempts -- the actor is unknown (no JWT
        // yet) but the email lets ops correlate brute-force patterns.
        // tenantId is null because the route is bypassed.
        request.audit(
          'auth.login.failed',
          { type: 'User', id: request.body.email },
          undefined,
          { email: request.body.email },
        );
        throw error;
      }
    },
  });

  // POST /auth/refresh
  fastify.route({
    method: 'POST',
    url: '/refresh',
    config: {
      tenant: 'bypass',
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['auth'],
      body: RefreshBodySchema,
      response: {
        200: createSuccessResponseSchema(RefreshResultSchema),
        401: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request) => {
      const tokens = await authService.refresh(request.body.refreshToken);
      return ok(tokens);
    },
  });

  // POST /auth/logout
  fastify.route({
    method: 'POST',
    url: '/logout',
    config: { tenant: 'bypass' },
    schema: {
      tags: ['auth'],
      body: LogoutBodySchema,
      response: { 204: NULL_RESPONSE },
    },
    handler: async (request, reply) => {
      await authService.logout(request.body.refreshToken);
      // Actor unknown after logout (the JWT was just revoked); we don't
      // have a stable subject id, so emit a generic event.
      request.audit('auth.logout', { type: 'Session', id: 'self' });
      return reply.status(204).send(null);
    },
  });

  // POST /auth/clear-sessions -- invalidates all tokens issued before now
  fastify.route({
    method: 'POST',
    url: '/clear-sessions',
    config: { tenant: 'bypass' },
    schema: {
      tags: ['auth'],
      response: {
        204: NULL_RESPONSE,
        401: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request, reply) => {
      await authService.clearSessions(request.auth!.sub);
      request.audit('auth.clear-sessions', {
        type: 'User',
        id: request.auth!.sub,
      });
      return reply.status(204).send(null);
    },
  });

  // -----------------------------------------------------------------------
  // Password reset
  // -----------------------------------------------------------------------

  fastify.route({
    method: 'POST',
    url: '/password-reset/request',
    config: {
      tenant: 'bypass',
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['auth'],
      body: PasswordResetRequestBodySchema,
      response: { 204: NULL_RESPONSE },
    },
    handler: async (request, reply) => {
      await authService.requestPasswordReset(request.body.email);
      // Always-204 -- the audit row records the attempt regardless of
      // whether the email exists, so ops can spot enumeration sweeps.
      request.audit(
        'auth.password-reset.requested',
        { type: 'User', id: request.body.email },
        undefined,
        { email: request.body.email },
      );
      return reply.status(204).send(null);
    },
  });

  fastify.route({
    method: 'POST',
    url: '/password-reset/confirm',
    config: {
      tenant: 'bypass',
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['auth'],
      body: PasswordResetConfirmBodySchema,
      response: {
        204: NULL_RESPONSE,
        401: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request, reply) => {
      await authService.confirmPasswordReset(
        request.body.token,
        request.body.newPassword,
      );
      request.audit('auth.password-reset.confirmed', {
        type: 'User',
        id: 'self',
      });
      return reply.status(204).send(null);
    },
  });

  // -----------------------------------------------------------------------
  // Email verification
  // -----------------------------------------------------------------------

  fastify.route({
    method: 'POST',
    url: '/email-verification/request',
    config: { tenant: 'bypass' },
    schema: {
      tags: ['auth'],
      response: {
        204: NULL_RESPONSE,
        401: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request, reply) => {
      await authService.requestEmailVerification(request.auth!.sub);
      request.audit('auth.email-verification.requested', {
        type: 'User',
        id: request.auth!.sub,
      });
      return reply.status(204).send(null);
    },
  });

  fastify.route({
    method: 'POST',
    url: '/email-verification/confirm',
    config: { tenant: 'bypass' },
    schema: {
      tags: ['auth'],
      body: EmailVerificationConfirmBodySchema,
      response: {
        204: NULL_RESPONSE,
        401: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request, reply) => {
      await authService.confirmEmailVerification(request.body.token);
      request.audit('auth.email-verification.confirmed', {
        type: 'User',
        id: 'self',
      });
      return reply.status(204).send(null);
    },
  });

  // -----------------------------------------------------------------------
  // OTP (MFA challenge)
  // -----------------------------------------------------------------------

  fastify.route({
    method: 'POST',
    url: '/otp/request',
    config: {
      tenant: 'bypass',
      rateLimit: { max: 3, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['auth'],
      body: OtpRequestBodySchema,
      response: {
        204: NULL_RESPONSE,
        401: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request, reply) => {
      const purpose = request.body.purpose ?? 'mfa-challenge';
      await authService.requestOtp({
        userId: request.auth!.sub,
        purpose,
      });
      request.audit(
        'auth.otp.requested',
        { type: 'User', id: request.auth!.sub },
        undefined,
        { purpose },
      );
      return reply.status(204).send(null);
    },
  });

  fastify.route({
    method: 'POST',
    url: '/otp/verify',
    config: {
      tenant: 'bypass',
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['auth'],
      body: OtpVerifyBodySchema,
      response: {
        204: NULL_RESPONSE,
        401: apiErrorEnvelopeSchema,
        429: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request, reply) => {
      const purpose = request.body.purpose ?? 'mfa-challenge';
      try {
        await authService.verifyOtp({
          userId: request.auth!.sub,
          code: request.body.code,
          purpose,
        });
        request.audit(
          'auth.otp.verified',
          { type: 'User', id: request.auth!.sub },
          undefined,
          { purpose },
        );
        return reply.status(204).send(null);
      } catch (error) {
        request.audit(
          'auth.otp.failed',
          { type: 'User', id: request.auth!.sub },
          undefined,
          { purpose },
        );
        throw error;
      }
    },
  });
};

export default authRoute;
export const autoPrefix = '/auth';
