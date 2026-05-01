import Fastify from 'fastify';
import fp from 'fastify-plugin';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAdminPlugin } from '../plugin.js';
import type * as SchemaModule from '../schema/index.js';
import type {
  AdminDiscoverable,
  PaginatedPage,
  SchemaRegistry,
  TableMeta,
} from '../types.js';

// Schema with a `tenant_id` column so the inferred spec is tenantScoped.
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
      name: 'tenantId',
      rawName: 'tenant_id',
      type: 'uuid',
      nullable: false,
      generated: false,
      defaultValue: null,
      enumValues: null,
      references: { table: 'tenants', column: 'id' },
      isPrimaryKey: false,
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
  ],
  primaryKey: ['id'],
  hasSoftDelete: false,
  hasTenantColumn: true,
};

vi.mock('../schema/index.js', async () => {
  const actual =
    await vi.importActual<typeof SchemaModule>('../schema/index.js');
  return {
    ...actual,
    createSchemaRegistry: async (): Promise<SchemaRegistry> => ({
      get: (name) => (name === 'posts' ? postsTable : undefined),
      all: () => [postsTable],
    }),
  };
});

const makePostsRepo = (): AdminDiscoverable => ({
  table: 'posts',
  async findPaginatedByPage(): Promise<PaginatedPage<unknown>> {
    return { items: [], total: 0 };
  },
  async findById() {
    return;
  },
  async create(data) {
    return data;
  },
  async update(_id, data) {
    return data;
  },
  async deleteById() {
    return;
  },
});

const makeMembershipsRepo = (
  rows: readonly { tenantId: string; role: string }[],
) => ({
  findAllForUser: async () => rows,
});

const makeTenantsRepo = (
  tenants: readonly { id: string; name: string; slug: string }[],
) => ({
  findById: async (id: string) => tenants.find((t) => t.id === id),
});

const extractCsrf = (html: string): string => {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match?.[1] ?? '';
};

const buildFastify = async (extras: {
  readonly memberships?: readonly { tenantId: string; role: string }[];
  readonly tenants?: readonly { id: string; name: string; slug: string }[];
}) => {
  const fastify = Fastify({ logger: false });

  fastify.decorate('diContainer', {
    cradle: {
      dataSource: {},
      postsRepository: makePostsRepo(),
      config: { JWT_SECRET: 'test-secret-at-least-32-characters-long' },
      ...(extras.memberships
        ? { membershipsRepository: makeMembershipsRepo(extras.memberships) }
        : {}),
      ...(extras.tenants
        ? { tenantsRepository: makeTenantsRepo(extras.tenants) }
        : {}),
    },
  });

  fastify.decorate('verifyAdmin', async (request) => {
    (request as { auth?: unknown }).auth = {
      sub: 'admin-1',
      role: 'admin',
      jti: 'j1',
      iat: Math.floor(Date.now() / 1000),
    };
  });

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

describe('tenants-switcher route', () => {
  let fastify: Awaited<ReturnType<typeof buildFastify>>;

  afterEach(async () => {
    if (fastify) await fastify.close();
  });

  it('GET /admin/_tenants renders memberships with tenant names', async () => {
    fastify = await buildFastify({
      memberships: [
        { tenantId: 't-1', role: 'owner' },
        { tenantId: 't-2', role: 'member' },
      ],
      tenants: [
        { id: 't-1', name: 'Acme', slug: 'acme' },
        { id: 't-2', name: 'Globex', slug: 'globex' },
      ],
    });
    const res = await fastify.inject({
      method: 'GET',
      url: '/admin/_tenants',
      headers: { cookie: '__Host-admin_session=fake' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Pick a tenant');
    expect(res.body).toContain('Acme');
    expect(res.body).toContain('Globex');
    expect(res.body).toContain('owner');
    expect(res.body).toContain('member');
  });

  it('GET /admin/_tenants shows empty state without memberships repo', async () => {
    fastify = await buildFastify({});
    const res = await fastify.inject({
      method: 'GET',
      url: '/admin/_tenants',
      headers: { cookie: '__Host-admin_session=fake' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Pick a tenant');
    expect(res.body).toContain('not a member of any tenant');
  });

  it('POST /admin/_tenants/select sets the cookie and redirects on success', async () => {
    fastify = await buildFastify({
      memberships: [{ tenantId: 't-1', role: 'owner' }],
      tenants: [{ id: 't-1', name: 'Acme', slug: 'acme' }],
    });
    const formRes = await fastify.inject({
      method: 'GET',
      url: '/admin/_tenants',
      headers: { cookie: '__Host-admin_session=fake' },
    });
    const csrf = extractCsrf(formRes.body);
    expect(csrf).not.toBe('');

    const res = await fastify.inject({
      method: 'POST',
      url: '/admin/_tenants/select',
      headers: {
        cookie: '__Host-admin_session=fake',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `_csrf=${encodeURIComponent(csrf)}&tenantId=t-1`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/admin/');
    const setCookie = res.headers['set-cookie'];
    const cookieString = Array.isArray(setCookie)
      ? setCookie.join(';')
      : setCookie;
    expect(cookieString).toContain('__Host-admin_tenant=t-1');
    expect(cookieString).toContain('HttpOnly');
    expect(cookieString).toContain('Secure');
  });

  it('POST /admin/_tenants/select rejects a tenant the user is not a member of', async () => {
    fastify = await buildFastify({
      memberships: [{ tenantId: 't-1', role: 'owner' }],
      tenants: [{ id: 't-1', name: 'Acme', slug: 'acme' }],
    });
    const formRes = await fastify.inject({
      method: 'GET',
      url: '/admin/_tenants',
      headers: { cookie: '__Host-admin_session=fake' },
    });
    const csrf = extractCsrf(formRes.body);

    const res = await fastify.inject({
      method: 'POST',
      url: '/admin/_tenants/select',
      headers: {
        cookie: '__Host-admin_session=fake',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `_csrf=${encodeURIComponent(csrf)}&tenantId=t-imposter`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('redirects to /admin/_tenants when a tenantScoped resource has no tenant frame', async () => {
    fastify = await buildFastify({
      memberships: [{ tenantId: 't-1', role: 'owner' }],
      tenants: [{ id: 't-1', name: 'Acme', slug: 'acme' }],
    });
    const res = await fastify.inject({
      method: 'GET',
      url: '/admin/posts',
      headers: { cookie: '__Host-admin_session=fake' },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/admin/_tenants');
  });

  it('htmx tenantScoped fetch without a frame returns hx-redirect 204', async () => {
    fastify = await buildFastify({
      memberships: [{ tenantId: 't-1', role: 'owner' }],
      tenants: [{ id: 't-1', name: 'Acme', slug: 'acme' }],
    });
    const res = await fastify.inject({
      method: 'GET',
      url: '/admin/posts',
      headers: {
        cookie: '__Host-admin_session=fake',
        'hx-request': 'true',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['hx-redirect']).toBe('/admin/_tenants');
  });
});
