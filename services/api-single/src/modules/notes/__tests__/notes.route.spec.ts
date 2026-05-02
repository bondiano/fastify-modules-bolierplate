import { describe, expect, it } from 'vitest';

import { setupIntegrationTest } from '#__tests__/helpers/setup-integration-test.ts';

describe('Notes routes (no tenancy)', () => {
  const { server: app, dataSource } = setupIntegrationTest();

  describe('POST /api/v1/notes', () => {
    it('creates a note without any tenant context', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        payload: { title: 'Hello', content: 'World' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.error).toBeNull();
      expect(body.data.title).toBe('Hello');
      expect(body.data.content).toBe('World');
      expect(body.data.id).toMatch(
        /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/,
      );
    });
  });

  describe('GET /api/v1/notes', () => {
    it('returns an empty paginated list when no notes exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes?page=1&limit=20',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.error).toBeNull();
      expect(body.data.items).toEqual([]);
      expect(body.data.pagination.total).toBe(0);
    });

    it('returns seeded notes with pagination metadata', async () => {
      await dataSource
        .insertInto('notes')
        .values({ title: 'First', content: 'Body A' })
        .execute();
      await dataSource
        .insertInto('notes')
        .values({ title: 'Second', content: 'Body B' })
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes?page=1&limit=20',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.items).toHaveLength(2);
      expect(body.data.pagination.total).toBe(2);
      expect(body.data.items.map((n: { title: string }) => n.title)).toEqual(
        expect.arrayContaining(['First', 'Second']),
      );
    });
  });

  describe('GET /api/v1/notes/:id', () => {
    it('returns the note envelope when found', async () => {
      const note = await dataSource
        .insertInto('notes')
        .values({ title: 'Findable', content: 'Body' })
        .returningAll()
        .executeTakeFirstOrThrow();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notes/${note.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.id).toBe(note.id);
      expect(body.data.title).toBe('Findable');
    });

    it('returns 404 when missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notes/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.data).toBeNull();
      expect(body.error.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/v1/notes/:id', () => {
    it('updates an existing note', async () => {
      const note = await dataSource
        .insertInto('notes')
        .values({ title: 'Old', content: 'Body' })
        .returningAll()
        .executeTakeFirstOrThrow();

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/notes/${note.id}`,
        payload: { title: 'New' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.title).toBe('New');
    });
  });

  describe('DELETE /api/v1/notes/:id', () => {
    it('soft-deletes the note and returns 204', async () => {
      const note = await dataSource
        .insertInto('notes')
        .values({ title: 'Bye', content: 'Body' })
        .returningAll()
        .executeTakeFirstOrThrow();

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/notes/${note.id}`,
      });

      expect(response.statusCode).toBe(204);

      const row = await dataSource
        .selectFrom('notes')
        .select(['id', 'deletedAt'])
        .where('id', '=', note.id)
        .executeTakeFirstOrThrow();
      expect(row.deletedAt).not.toBeNull();
    });
  });
});
