import Fastify from 'fastify';
import fp from 'fastify-plugin';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminPlugin } from './plugin.js';
import type * as SchemaModule from './schema/index.js';
import type {
  AdminDiscoverable,
  PaginatedPage,
  SchemaRegistry,
  TableMeta,
} from './types.js';

// Stub the schema registry creator so the plugin test never touches a DB.
const postsTable: TableMeta = {
  name: 'posts',
  columns: [
    {
      name: 'id',
      rawName: 'id',
      type: 'uuid',
      nullable: false,
      generated: true,
      defaultValue: null,
      enumValues: null,
      references: null,
      isPrimaryKey: true,
      maxLength: null,
    },
    {
      name: 'title',
      rawName: 'title',
      type: 'varchar',
      nullable: false,
      generated: false,
      defaultValue: null,
      enumValues: null,
      references: null,
      isPrimaryKey: false,
      maxLength: 200,
    },
    {
      name: 'createdAt',
      rawName: 'created_at',
      type: 'timestamptz',
      nullable: false,
      generated: false,
      defaultValue: 'now()',
      enumValues: null,
      references: null,
      isPrimaryKey: false,
      maxLength: null,
    },
  ],
  primaryKey: ['id'],
  hasSoftDelete: false,
  hasTenantColumn: false,
};

vi.mock('./schema/index.js', async () => {
  const actual =
    await vi.importActual<typeof SchemaModule>('./schema/index.js');
  return {
    ...actual,
    createSchemaRegistry: async (): Promise<SchemaRegistry> => ({
      get: (name) => (name === 'posts' ? postsTable : undefined),
      all: () => [postsTable],
    }),
  };
});

interface PostRow {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
}

const makePostsRepo = () => {
  const rows: PostRow[] = [
    { id: '1', title: 'Hello', createdAt: '2025-01-01T00:00:00Z' },
    { id: '2', title: 'World', createdAt: '2025-01-02T00:00:00Z' },
  ];
  const repo: AdminDiscoverable = {
    table: 'posts',
    async findPaginatedByPage(): Promise<PaginatedPage<unknown>> {
      return { items: rows, total: rows.length };
    },
    async findById(id) {
      return rows.find((r) => r.id === id);
    },
    async create(data) {
      return data;
    },
    async update(_id, data) {
      return data;
    },
    async deleteById(id) {
      return rows.find((r) => r.id === id);
    },
  };
  return repo;
};

/** Extract CSRF token from a rendered form page. */
const extractCsrf = (html: string): string => {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match?.[1] ?? '';
};

interface TestCradle {
  readonly postsRepository: AdminDiscoverable;
}

const getTestRepo = (
  fastify: Awaited<ReturnType<typeof buildFastify>>,
): AdminDiscoverable =>
  (fastify as unknown as { diContainer: { cradle: TestCradle } }).diContainer
    .cradle.postsRepository;

const buildFastify = async () => {
  const fastify = Fastify({ logger: false });

  // Minimal DI cradle decoration (no @fastify/awilix required -- the
  // plugin only reads `diContainer.cradle`).
  fastify.decorate('diContainer', {
    cradle: {
      dataSource: {},
      postsRepository: makePostsRepo(),
      config: { JWT_SECRET: 'test-secret-at-least-32-characters-long' },
    },
  });

  // Stub `verifyAdmin`: accept every request by populating `request.auth`.
  fastify.decorate('verifyAdmin', async (request) => {
    (request as { auth?: unknown }).auth = {
      sub: 'admin-1',
      role: 'admin',
      jti: 'j1',
      iat: Math.floor(Date.now() / 1000),
    };
  });

  // Bypass the plugin-dependency guard; the test harness registers the
  // plugin via `fp`'s escape hatch (`skip-override` + no `dependencies`
  // enforcement) by calling the underlying function directly.
  // Easier: just override the dependency check by letting fastify-plugin
  // report it missing. We work around by stubbing a noop verifyAdmin
  // above; the dependency list is only checked by fastify-plugin itself.
  // Register the plugin without the auto-dependency assertions:
  // `fp()` already wraps; we register with `{ skipOverride: false }` and
  // rely on the test's decorate call.
  //
  // `fastify-plugin`'s dependencies list is enforced by fastify; to make
  // this work we register fake plugins with the required names.
  await fastify.register(
    fp(async (): Promise<void> => {}, { name: '@fastify/awilix' }),
  );
  await fastify.register(
    fp(async (): Promise<void> => {}, { name: '@kit/auth' }),
  );
  await fastify.register(
    fp(async (): Promise<void> => {}, { name: '@kit/authz' }),
  );

  await fastify.register(createAdminPlugin, {
    prefix: '/admin',
    title: 'Test Admin',
    includeTables: ['posts'],
  });
  await fastify.ready();
  return fastify;
};

describe('createAdminPlugin (integration)', () => {
  let fastify: Awaited<ReturnType<typeof buildFastify>>;

  beforeEach(async () => {
    fastify = await buildFastify();
  });
  afterEach(async () => {
    await fastify.close();
  });

  it('serves the CSS asset without auth', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/admin/_assets/admin.css',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
  });

  it('GET /admin/login renders a login form', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/admin/login' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sign in');
    expect(res.body).toContain('name="email"');
  });

  it('GET /admin redirects to login without a session cookie', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/admin/' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/admin/login');
  });

  it('GET /admin renders the dashboard with a valid session cookie', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/admin/',
      headers: { cookie: '__Host-admin_session=fake-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Dashboard');
    expect(res.body).toContain('Posts');
  });

  it('GET /admin/posts renders the data table', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/admin/posts',
      headers: { cookie: '__Host-admin_session=fake-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('admin-data-table');
    expect(res.body).toContain('Hello');
    expect(res.body).toContain('World');
  });

  it('GET /admin/posts/new renders an empty form', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/admin/posts/new',
      headers: { cookie: '__Host-admin_session=fake-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('admin-form');
    expect(res.body).toContain('name="_csrf"');
  });

  it('htmx request without session returns 401', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/admin/posts',
      headers: { 'hx-request': 'true' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /admin/posts with repo error re-renders form with error banner', async () => {
    // Get the create form to extract a valid CSRF token
    const formRes = await fastify.inject({
      method: 'GET',
      url: '/admin/posts/new',
      headers: { cookie: '__Host-admin_session=fake-token' },
    });
    const csrfToken = extractCsrf(formRes.body);
    expect(csrfToken).not.toBe('');

    // Make the repo throw a FK violation
    const repo = getTestRepo(fastify);
    const originalCreate = repo.create;
    repo.create = async () => {
      throw new Error(
        'insert or update on table "posts" violates foreign key constraint "posts_author_id_fkey"',
      );
    };

    const res = await fastify.inject({
      method: 'POST',
      url: '/admin/posts',
      headers: {
        cookie: '__Host-admin_session=fake-token',
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      payload: `_csrf=${encodeURIComponent(csrfToken)}&title=Test&createdAt=2025-01-01`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('form-error');
    expect(res.body).toContain('Referenced record does not exist');

    repo.create = originalCreate;
  });

  it('POST /admin/posts with unique constraint error shows user-friendly message', async () => {
    const formRes = await fastify.inject({
      method: 'GET',
      url: '/admin/posts/new',
      headers: { cookie: '__Host-admin_session=fake-token' },
    });
    const csrfToken = extractCsrf(formRes.body);

    const repo = getTestRepo(fastify);
    const originalCreate = repo.create;
    repo.create = async () => {
      throw new Error(
        'duplicate key value violates unique constraint "posts_title_key"',
      );
    };

    const res = await fastify.inject({
      method: 'POST',
      url: '/admin/posts',
      headers: {
        cookie: '__Host-admin_session=fake-token',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `_csrf=${encodeURIComponent(csrfToken)}&title=Test&createdAt=2025-01-01`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('form-error');
    expect(res.body).toContain('A record with these values already exists');

    repo.create = originalCreate;
  });

  it('PATCH /admin/posts/:id with repo error re-renders form with error banner', async () => {
    // Get the edit form to extract a valid CSRF token
    const formRes = await fastify.inject({
      method: 'GET',
      url: '/admin/posts/1',
      headers: { cookie: '__Host-admin_session=fake-token' },
    });
    const csrfToken = extractCsrf(formRes.body);
    expect(csrfToken).not.toBe('');

    const repo = getTestRepo(fastify);
    const originalUpdate = repo.update;
    repo.update = async () => {
      throw new Error(
        'duplicate key value violates unique constraint "posts_title_key"',
      );
    };

    const res = await fastify.inject({
      method: 'PATCH',
      url: '/admin/posts/1',
      headers: {
        cookie: '__Host-admin_session=fake-token',
        'content-type': 'application/x-www-form-urlencoded',
        'hx-request': 'true',
      },
      payload: `_csrf=${encodeURIComponent(csrfToken)}&title=Duplicate`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('form-error');
    expect(res.body).toContain('A record with these values already exists');

    repo.update = originalUpdate;
  });
});
