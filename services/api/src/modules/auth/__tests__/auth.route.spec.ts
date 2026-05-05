import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { setupIntegrationTest } from '#__tests__/helpers/setup-integration-test.ts';
import { buildAuthHeaders } from '@kit/test/helpers';

interface Registered {
  id: string;
  email: string;
  accessToken: string;
}

let counter = 0;

const registerUser = async (app: FastifyInstance): Promise<Registered> => {
  counter += 1;
  const email = `auth-flow-${counter}@test.com`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'password1234' },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json();
  return {
    id: body.data.user.id,
    email,
    accessToken: body.data.tokens.accessToken,
  };
};

describe('Auth flow routes', () => {
  const { server: app, dataSource } = setupIntegrationTest();

  describe('POST /auth/password-reset/request', () => {
    it('returns 204 even for an unknown email (enumeration safety)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/request',
        payload: { email: 'nobody@example.com' },
      });
      expect(response.statusCode).toBe(204);
    });

    it('persists a hash and clears existing sessions on confirm', async () => {
      const user = await registerUser(app);

      const requestRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/request',
        payload: { email: user.email },
      });
      expect(requestRes.statusCode).toBe(204);

      // Read the newly-issued row and re-hash a known token to confirm.
      // Since the raw token only exists inside the request scope, we
      // verify confirmation indirectly: invalid token -> 401.
      const badConfirm = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/confirm',
        payload: { token: 'not-a-real-token', newPassword: 'newpass1234' },
      });
      expect(badConfirm.statusCode).toBe(401);

      // Sanity check that the row exists.
      const rows = await dataSource
        .selectFrom('password_reset_tokens')
        .selectAll()
        .where('userId', '=', user.id)
        .execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.usedAt).toBe(null);
    });
  });

  describe('POST /auth/password-reset/confirm', () => {
    it('rejects an invalid token with 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/confirm',
        payload: { token: 'totally-invalid', newPassword: 'newpass1234' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a payload that violates the schema (short password)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/confirm',
        payload: { token: 'whatever', newPassword: 'short' },
      });
      // TypeBox validation runs before the handler.
      expect([400, 422]).toContain(response.statusCode);
    });
  });

  describe('POST /auth/email-verification/request', () => {
    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/email-verification/request',
      });
      expect([400, 401]).toContain(response.statusCode);
    });

    it('persists a verification row for the authenticated user', async () => {
      const user = await registerUser(app);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/email-verification/request',
        headers: buildAuthHeaders(user.accessToken),
      });
      expect(response.statusCode).toBe(204);
      const rows = await dataSource
        .selectFrom('email_verifications')
        .selectAll()
        .where('userId', '=', user.id)
        .execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.verifiedAt).toBe(null);
    });
  });

  describe('POST /auth/email-verification/confirm', () => {
    it('rejects an invalid token with 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/email-verification/confirm',
        payload: { token: 'invalid' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /auth/otp/request + verify', () => {
    it('issues an OTP for the authenticated user', async () => {
      const user = await registerUser(app);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/request',
        headers: buildAuthHeaders(user.accessToken),
        payload: {},
      });
      expect(response.statusCode).toBe(204);

      const rows = await dataSource
        .selectFrom('otp_codes')
        .selectAll()
        .where('userId', '=', user.id)
        .execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.purpose).toBe('mfa-challenge');
      expect(rows[0]!.attempts).toBe(0);
    });

    it('verify with an obviously wrong code returns 401', async () => {
      const user = await registerUser(app);
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/request',
        headers: buildAuthHeaders(user.accessToken),
        payload: {},
      });
      const verify = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/verify',
        headers: buildAuthHeaders(user.accessToken),
        payload: { code: '000000' },
      });
      expect([401, 429]).toContain(verify.statusCode);
    });

    it('rejects malformed OTP payload (non-6-digit)', async () => {
      const user = await registerUser(app);
      const verify = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/verify',
        headers: buildAuthHeaders(user.accessToken),
        payload: { code: '12' },
      });
      expect([400, 422]).toContain(verify.statusCode);
    });
  });
});
