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
}

let userCounter = 0;

const registerUser = async (app: FastifyInstance): Promise<RegisteredUser> => {
  userCounter += 1;
  const email = `poster-${userCounter}@test.com`;
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

const insertPost = async (
  dataSource: Kysely<DB>,
  authorId: string,
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
      authorId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

describe('Posts routes', () => {
  const { server: app, dataSource } = setupIntegrationTest();

  describe('GET /api/v1/posts', () => {
    it('returns an empty paginated list when no posts exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/posts?page=1&limit=20',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.error).toBeNull();
      expect(body.data.items).toEqual([]);
      expect(body.data.pagination.total).toBe(0);
      expect(body.data.pagination.page).toBe(1);
      expect(body.data.pagination.limit).toBe(20);
    });

    it('returns seeded posts with pagination metadata', async () => {
      const author = await registerUser(app);
      await insertPost(dataSource, author.id, { title: 'First' });
      await insertPost(dataSource, author.id, { title: 'Second' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/posts?page=1&limit=20',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.items).toHaveLength(2);
      expect(body.data.pagination.total).toBe(2);
      expect(body.data.items.map((p: { title: string }) => p.title)).toEqual(
        expect.arrayContaining(['First', 'Second']),
      );
    });
  });

  describe('GET /api/v1/posts/:id', () => {
    it('returns 200 with the post envelope when found', async () => {
      const author = await registerUser(app);
      const post = await insertPost(dataSource, author.id);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/posts/${post.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.error).toBeNull();
      expect(body.data.id).toBe(post.id);
      expect(body.data.title).toBe(post.title);
    });

    it('returns 404 with the error envelope when missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/posts/00000000-0000-0000-0000-000000000000',
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
    it('rejects unauthenticated requests with 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        payload: { title: 'x', content: 'y' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('creates a post owned by the authenticated caller', async () => {
      const author = await registerUser(app);

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
    });
  });

  describe('PATCH /api/v1/posts/:id', () => {
    it('lets the owner update their post', async () => {
      const owner = await registerUser(app);
      const post = await insertPost(dataSource, owner.id);

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

    it("forbids a non-owner from updating someone else's post", async () => {
      const owner = await registerUser(app);
      const outsider = await registerUser(app);
      const post = await insertPost(dataSource, owner.id);

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/posts/${post.id}`,
        headers: buildAuthHeaders(outsider.accessToken),
        payload: { title: 'Hijack' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for a missing post', async () => {
      const owner = await registerUser(app);

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
      const owner = await registerUser(app);
      const post = await insertPost(dataSource, owner.id);

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
