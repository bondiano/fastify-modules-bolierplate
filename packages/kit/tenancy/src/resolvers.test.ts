import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  fromCookie,
  fromHeader,
  fromJwtClaim,
  fromSubdomain,
  fromUserDefault,
} from './resolvers.js';

const buildRequest = (overrides: Partial<FastifyRequest>): FastifyRequest =>
  ({
    headers: {},
    hostname: '',
    ...overrides,
  }) as unknown as FastifyRequest;

describe('fromHeader', () => {
  it('returns the header value when present', async () => {
    const resolver = fromHeader('x-tenant-id');
    const request = buildRequest({ headers: { 'x-tenant-id': 'acme' } });
    expect(await resolver(request)).toBe('acme');
  });

  it('returns null when the header is missing', async () => {
    const resolver = fromHeader();
    expect(await resolver(buildRequest({}))).toBeNull();
  });

  it('returns null for an empty / whitespace header', async () => {
    const resolver = fromHeader();
    const request = buildRequest({ headers: { 'x-tenant-id': '   ' } });
    expect(await resolver(request)).toBeNull();
  });

  it('uses lowercase lookup regardless of how the option is cased', async () => {
    const resolver = fromHeader('X-Tenant-ID');
    const request = buildRequest({ headers: { 'x-tenant-id': 'acme' } });
    expect(await resolver(request)).toBe('acme');
  });

  it('takes the first value when an array is provided', async () => {
    const resolver = fromHeader();
    const request = buildRequest({
      headers: { 'x-tenant-id': ['acme', 'globex'] },
    });
    expect(await resolver(request)).toBe('acme');
  });
});

describe('fromSubdomain', () => {
  it('returns the leftmost label for a multi-segment host', async () => {
    const resolver = fromSubdomain();
    expect(await resolver(buildRequest({ hostname: 'acme.example.com' }))).toBe(
      'acme',
    );
  });

  it('returns null on an apex domain', async () => {
    const resolver = fromSubdomain();
    expect(
      await resolver(buildRequest({ hostname: 'example.com' })),
    ).toBeNull();
  });

  it('ignores www by default', async () => {
    const resolver = fromSubdomain();
    expect(
      await resolver(buildRequest({ hostname: 'www.example.com' })),
    ).toBeNull();
  });

  it('honours a custom ignore list', async () => {
    const resolver = fromSubdomain({ ignore: ['app'] });
    expect(
      await resolver(buildRequest({ hostname: 'app.example.com' })),
    ).toBeNull();
    expect(await resolver(buildRequest({ hostname: 'acme.example.com' }))).toBe(
      'acme',
    );
  });

  it('strips the port from the hostname', async () => {
    const resolver = fromSubdomain();
    expect(
      await resolver(buildRequest({ hostname: 'acme.example.com:3000' })),
    ).toBe('acme');
  });
});

describe('fromJwtClaim', () => {
  it('reads the named claim from request.auth', async () => {
    const resolver = fromJwtClaim('tenant_id');
    const request = buildRequest({});
    (request as { auth?: unknown }).auth = { sub: 'u1', tenant_id: 't1' };
    expect(await resolver(request)).toBe('t1');
  });

  it('returns null when request.auth is missing', async () => {
    const resolver = fromJwtClaim();
    expect(await resolver(buildRequest({}))).toBeNull();
  });

  it('returns null when the claim is missing', async () => {
    const resolver = fromJwtClaim('tenant_id');
    const request = buildRequest({});
    (request as { auth?: unknown }).auth = { sub: 'u1' };
    expect(await resolver(request)).toBeNull();
  });
});

describe('fromCookie', () => {
  it('reads the named cookie from request.cookies', async () => {
    const resolver = fromCookie('admin_tenant');
    const request = buildRequest({});
    (request as { cookies?: unknown }).cookies = { admin_tenant: 'acme' };
    expect(await resolver(request)).toBe('acme');
  });

  it('returns null when request.cookies is undefined (no @fastify/cookie)', async () => {
    const resolver = fromCookie('admin_tenant');
    expect(await resolver(buildRequest({}))).toBeNull();
  });

  it('returns null when the named cookie is missing', async () => {
    const resolver = fromCookie('admin_tenant');
    const request = buildRequest({});
    (request as { cookies?: unknown }).cookies = { other: 'x' };
    expect(await resolver(request)).toBeNull();
  });

  it('treats an empty / whitespace cookie value as missing', async () => {
    const resolver = fromCookie('admin_tenant');
    const request = buildRequest({});
    (request as { cookies?: unknown }).cookies = { admin_tenant: '  ' };
    expect(await resolver(request)).toBeNull();
  });
});

describe('fromUserDefault', () => {
  it('calls the resolver with the auth subject and returns its result', async () => {
    const resolveDefaultTenant = vi.fn().mockResolvedValue('default-tenant');
    const resolver = fromUserDefault({ resolveDefaultTenant });
    const request = buildRequest({});
    (request as { auth?: unknown }).auth = { sub: 'user-42' };
    expect(await resolver(request)).toBe('default-tenant');
    expect(resolveDefaultTenant).toHaveBeenCalledWith('user-42');
  });

  it('returns null without invoking the callback when auth is missing', async () => {
    const resolveDefaultTenant = vi.fn();
    const resolver = fromUserDefault({ resolveDefaultTenant });
    expect(await resolver(buildRequest({}))).toBeNull();
    expect(resolveDefaultTenant).not.toHaveBeenCalled();
  });

  it('returns null when the callback yields null', async () => {
    const resolveDefaultTenant = vi.fn().mockResolvedValue(null);
    const resolver = fromUserDefault({ resolveDefaultTenant });
    const request = buildRequest({});
    (request as { auth?: unknown }).auth = { sub: 'user-42' };
    expect(await resolver(request)).toBeNull();
  });
});
