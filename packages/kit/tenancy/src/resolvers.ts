import type { FastifyRequest } from 'fastify';

export type TenantResolver = (
  request: FastifyRequest,
) => Promise<string | null> | string | null;

const normalize = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Reads the tenant id from a request header. Header lookup is
 * case-insensitive (Fastify lowercases header names internally).
 *
 * **WARNING:** the header value is unverified -- any client can claim any
 * tenant. Pair this resolver with the plugin's `resolveMembership`
 * option so the resolved id is checked against the authenticated user's
 * memberships before the request enters scoped code. Without that
 * check, an attacker can spoof `X-Tenant-ID` and write into another
 * tenant's namespace.
 */
export const fromHeader = (headerName = 'x-tenant-id'): TenantResolver => {
  const key = headerName.toLowerCase();
  return (request) => {
    const raw = request.headers[key];
    return normalize(Array.isArray(raw) ? raw[0] : raw);
  };
};

export interface FromSubdomainOptions {
  /** Subdomain labels to skip even when present (default: `['www']`). */
  readonly ignore?: readonly string[];
}

/**
 * Extracts the leftmost subdomain (e.g. `acme.example.com` -> `acme`).
 * Returns null on apex domains and ignored labels.
 *
 * Returns the **raw label** -- only useful when the tenant id IS the
 * subdomain string. For schemes where the subdomain is a slug pointing
 * to a UUID id, use `fromSubdomainBySlug` instead.
 */
export const fromSubdomain = (
  options: FromSubdomainOptions = {},
): TenantResolver => {
  const ignore = new Set(options.ignore ?? ['www']);
  return (request) => {
    const host = request.hostname?.split(':')[0];
    if (!host) return null;
    const labels = host.split('.');
    if (labels.length <= 2) return null;
    const candidate = labels[0];
    if (!candidate || ignore.has(candidate)) return null;
    return candidate;
  };
};

export interface FromSubdomainBySlugOptions extends FromSubdomainOptions {
  /**
   * Resolves a slug (`acme`) to the canonical tenant id (`uuid`). Typically
   * wires `tenantsRepository.findBySlug(slug).then(t => t?.id ?? null)`.
   */
  readonly resolveTenantId: (slug: string) => Promise<string | null>;
}

/**
 * Subdomain resolver that converts the leftmost label to a tenant id
 * via a consumer-provided slug-to-id lookup. Use this when the tenant
 * id is a UUID (the canonical case) -- `fromSubdomain` would otherwise
 * feed the slug into a `WHERE tenant_id = uuid` filter and fail.
 */
export const fromSubdomainBySlug = (
  options: FromSubdomainBySlugOptions,
): TenantResolver => {
  const ignore = new Set(options.ignore ?? ['www']);
  return async (request) => {
    const host = request.hostname?.split(':')[0];
    if (!host) return null;
    const labels = host.split('.');
    if (labels.length <= 2) return null;
    const candidate = labels[0];
    if (!candidate || ignore.has(candidate)) return null;
    const tenantId = await options.resolveTenantId(candidate);
    return normalize(tenantId);
  };
};

/**
 * Reads a JWT claim off `request.auth`. Decoupled from `@kit/auth`'s
 * `AccessTokenPayload`: a structural cast lets the resolver work the
 * moment auth surfaces the claim, without a cross-package import today.
 *
 * **WARNING:** the JWT is verified upstream by `@kit/auth`, but the claim
 * itself is unverified data baked into the token at issue time. If your
 * issuer doesn't enforce that the claim matches a real membership, pair
 * with `resolveMembership` (see plugin docs).
 */
export const fromJwtClaim = (claim = 'tenant_id'): TenantResolver => {
  return (request) => {
    const auth = (request as { auth?: Record<string, unknown> }).auth;
    return normalize(auth?.[claim]);
  };
};

/**
 * Reads the tenant id from a cookie set by the admin tenant switcher
 * (or any other UI). Requires `@fastify/cookie` so `request.cookies` is
 * populated -- without it, the resolver returns null and the chain
 * continues to the next resolver. Pair this with `fromUserDefault` so
 * a fresh visitor without a cookie still resolves to their default
 * tenant.
 *
 * **WARNING:** the cookie value is unverified user-controlled input.
 * Pair with `resolveMembership` (plugin docs) so a forged cookie can't
 * grant cross-tenant access.
 */
export const fromCookie = (cookieName: string): TenantResolver => {
  return (request) => {
    const cookies = (
      request as FastifyRequest & {
        cookies?: Readonly<Record<string, string | undefined>>;
      }
    ).cookies;
    return normalize(cookies?.[cookieName]);
  };
};

export interface FromUserDefaultOptions {
  readonly resolveDefaultTenant: (userId: string) => Promise<string | null>;
  /**
   * Override how the user id is read off the request. Defaults to
   * `request.auth?.sub`, matching `@kit/auth`'s AccessTokenPayload.
   * Override when your auth surface puts the user id elsewhere (e.g.
   * `request.user.id`, `request.session.userId`).
   */
  readonly getUserId?: (request: FastifyRequest) => string | null;
}

const defaultGetUserId = (request: FastifyRequest): string | null => {
  const auth = (request as { auth?: { sub?: unknown } }).auth;
  return typeof auth?.sub === 'string' ? auth.sub : null;
};

/**
 * Falls back to the user's default membership. The lookup is injected so
 * `@kit/tenancy` does not depend on `@kit/db` or any users repository --
 * the consumer wires `usersRepository.findDefaultTenantId` (or
 * `membershipsRepository.findDefaultForUser`).
 */
export const fromUserDefault = (
  options: FromUserDefaultOptions,
): TenantResolver => {
  const getUserId = options.getUserId ?? defaultGetUserId;
  return async (request) => {
    const userId = getUserId(request);
    if (!userId) return null;
    const result = await options.resolveDefaultTenant(userId);
    return normalize(result);
  };
};
