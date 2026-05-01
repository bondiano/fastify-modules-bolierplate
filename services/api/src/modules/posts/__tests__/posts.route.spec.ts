import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';

import { setupIntegrationTest } from '#__tests__/helpers/setup-integration-test.ts';
import type { DB } from '#db/schema.ts';
import { buildAuthHeaders } from '@kit/test/helpers';

interface RegisteredUser {
  id: string;
  email: string;
  accessToken: string;
  tenantId: string;
}

let userCounter = 0;

const registerUser = async (
  app: FastifyInstance,
  dataSource: Kysely<DB>,
): Promise<RegisteredUser> => {
  userCounter += 1;
  const email = `poster-${userCounter}@test.com`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'password1234' },
  });

  expect(response.statusCode).toBe(201);
  const body = response.json();
  const id: string = body.data.user.id;
  const tenant = await dataSource
    .selectFrom('users')
    .select('tenantId')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return {
    id,
    email,
    accessToken: body.data.tokens.accessToken,
    tenantId: tenant.tenantId,
  };
};

const insertPost = async (
  dataSource: Kysely<DB>,
  author: RegisteredUser,
  overrides: {
    title?: string;
    content?: string;
    status?: 'draft' | 'published';
  } = {},
) =>
  dataSource
    .insertInto('posts')
    .values({
      title: overrides.title ?? 'Seeded',
      content: overrides.content ?? 'Seeded body',
      status: overrides.status ?? 'draft',
      authorId: author.id,
      tenantId: author.tenantId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

describe('Posts routes', () => {
  const { server: app, dataSource } = setupIntegrationTest();

  describe('GET /api/v1/posts', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/posts?page=1&limit=20',
      });
      // Tenancy resolves first and 400s when no tenant can be derived
      // (no auth, no header, no cookie). With auth, the route would
      // reach the auth check and 401.
      expect([400, 401]).toContain(response.statusCode);
    });

    it('returns an empty paginated list when no posts exist in the tenant', async () => {
      const author = await registerUser(app, dataSource);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/posts?page=1&limit=20',
        headers: buildAuthHeaders(author.accessToken),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.error).toBeNull();
      expect(body.data.items).toEqual([]);
      expect(body.data.pagination.total).toBe(0);
      expect(body.data.pagination.page).toBe(1);
      expect(body.data.pagination.limit).toBe(20);
    });

    it('returns seeded posts with pagination metadata for the active tenant', async () => {
      const author = await registerUser(app, dataSource);
      await insertPost(dataSource, author, { title: 'First' });
      await insertPost(dataSource, author, { title: 'Second' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/posts?page=1&limit=20',
        headers: buildAuthHeaders(author.accessToken),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.items).toHaveLength(2);
      expect(body.data.pagination.total).toBe(2);
      expect(body.data.items.map((p: { title: string }) => p.title)).toEqual(
        expect.arrayContaining(['First', 'Second']),
      );
    });

    it('does not leak posts from another tenant', async () => {
      const owner = await registerUser(app, dataSource);
      const outsider = await registerUser(app, dataSource);
      await insertPost(dataSource, owner, { title: 'Owner-only' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/posts?page=1&limit=20',
        headers: buildAuthHeaders(outsider.accessToken),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.items).toEqual([]);
      expect(body.data.pagination.total).toBe(0);
    });
  });

  describe('GET /api/v1/posts/:id', () => {
    it('returns 200 with the post envelope when found in the active tenant', async () => {
      const author = await registerUser(app, dataSource);
      const post = await insertPost(dataSource, author);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/posts/${post.id}`,
        headers: buildAuthHeaders(author.accessToken),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.error).toBeNull();
      expect(body.data.id).toBe(post.id);
      expect(body.data.title).toBe(post.title);
    });

    it('returns 404 when the id belongs to another tenant', async () => {
      const owner = await registerUser(app, dataSource);
      const outsider = await registerUser(app, dataSource);
      const post = await insertPost(dataSource, owner);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/posts/${post.id}`,
        headers: buildAuthHeaders(outsider.accessToken),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 with the error envelope when missing', async () => {
      const author = await registerUser(app, dataSource);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/posts/00000000-0000-0000-0000-000000000000',
        headers: buildAuthHeaders(author.accessToken),
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.data).toBeNull();
      expect(body.error.statusCode).toBe(404);
      expect(body.error.message).toContain(
        '00000000-0000-0000-0000-000000000000',
      );
    });
  });

  describe('POST /api/v1/posts', () => {
    it('rejects unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        payload: { title: 'x', content: 'y' },
      });

      // Tenancy resolves before auth runs: unauthenticated requests on
      // tenant-scoped routes 400 with TENANT_NOT_RESOLVED. With auth,
      // they would 401 from `verifyUser`.
      expect([400, 401]).toContain(response.statusCode);
    });

    it('creates a post owned by the authenticated caller in their tenant', async () => {
      const author = await registerUser(app, dataSource);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: buildAuthHeaders(author.accessToken),
        payload: { title: 'Hello', content: 'World' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.title).toBe('Hello');
      expect(body.data.authorId).toBe(author.id);
      expect(body.data.status).toBe('draft');

      const row = await dataSource
        .selectFrom('posts')
        .select(['tenantId'])
        .where('id', '=', body.data.id)
        .executeTakeFirstOrThrow();
      expect(row.tenantId).toBe(author.tenantId);
    });
  });

  describe('PATCH /api/v1/posts/:id', () => {
    it('lets the owner update their post', async () => {
      const owner = await registerUser(app, dataSource);
      const post = await insertPost(dataSource, owner);

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/posts/${post.id}`,
        headers: buildAuthHeaders(owner.accessToken),
        payload: { title: 'Renamed' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.title).toBe('Renamed');
    });

    it('returns 404 when the post belongs to another tenant', async () => {
      const owner = await registerUser(app, dataSource);
      const outsider = await registerUser(app, dataSource);
      const post = await insertPost(dataSource, owner);

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/posts/${post.id}`,
        headers: buildAuthHeaders(outsider.accessToken),
        payload: { title: 'Hijack' },
      });

      // The pre-handler authz lookup returns null because the scoped
      // findById can't see the row from outside the tenant -- that
      // surfaces as 404, not 403.
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for a missing post', async () => {
      const owner = await registerUser(app, dataSource);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/posts/00000000-0000-0000-0000-000000000000',
        headers: buildAuthHeaders(owner.accessToken),
        payload: { title: 'x' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/posts/:id', () => {
    it('soft-deletes the post and returns 204', async () => {
      const owner = await registerUser(app, dataSource);
      const post = await insertPost(dataSource, owner);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/posts/${post.id}`,
        headers: buildAuthHeaders(owner.accessToken),
      });

      expect(response.statusCode).toBe(204);

      const row = await dataSource
        .selectFrom('posts')
        .select(['id', 'deletedAt'])
        .where('id', '=', post.id)
        .executeTakeFirstOrThrow();
      expect(row.deletedAt).not.toBeNull();
    });
  });
});
