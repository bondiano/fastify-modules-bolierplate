import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { setupIntegrationTest } from '#__tests__/helpers/setup-integration-test.ts';
import { buildAuthHeaders } from '@kit/test/helpers';

interface RegisteredUser {
  id: string;
  email: string;
  accessToken: string;
}

let userCounter = 0;

const registerUser = async (app: FastifyInstance): Promise<RegisteredUser> => {
  userCounter += 1;
  const email = `viewer-${userCounter}@test.com`;
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

describe('Users routes', () => {
  const { server: app } = setupIntegrationTest();

  describe('GET /api/v1/users/:id', () => {
    it('rejects unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users/00000000-0000-0000-0000-000000000000',
      });

      // Tenancy resolves before auth runs: unauthenticated requests on
      // tenant-scoped routes 400 with TENANT_NOT_RESOLVED. With auth,
      // they would 401 from `verifyUser`. Either is acceptable -- the
      // request is not allowed through.
      expect([400, 401]).toContain(response.statusCode);
    });

    it("returns the caller's own record", async () => {
      const caller = await registerUser(app);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${caller.id}`,
        headers: buildAuthHeaders(caller.accessToken),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.error).toBeNull();
      expect(body.data.id).toBe(caller.id);
      expect(body.data.email).toBe(caller.email);
      // Never leak the password hash through the API response.
      expect(body.data).not.toHaveProperty('passwordHash');
    });

    it('returns 404 with the error envelope when the user is missing', async () => {
      const caller = await registerUser(app);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users/00000000-0000-0000-0000-000000000000',
        headers: buildAuthHeaders(caller.accessToken),
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.data).toBeNull();
      expect(body.error.statusCode).toBe(404);
      expect(body.error.message).toContain(
        '00000000-0000-0000-0000-000000000000',
      );
    });

    it('returns 404 when the lookup id belongs to another tenant', async () => {
      const caller = await registerUser(app);
      const other = await registerUser(app);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${other.id}`,
        headers: buildAuthHeaders(caller.accessToken),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/users/me', () => {
    it('returns the authenticated user', async () => {
      const caller = await registerUser(app);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me',
        headers: buildAuthHeaders(caller.accessToken),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.id).toBe(caller.id);
      expect(body.data.email).toBe(caller.email);
    });

    it('rejects unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me',
      });

      // See note on `GET /:id` -- tenancy 400 vs auth 401 race.
      expect([400, 401]).toContain(response.statusCode);
    });
  });
});
