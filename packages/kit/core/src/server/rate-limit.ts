import type { RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';

/**
 * Per-route rate limit helper. Spreads into Fastify route options.
 *
 * `@fastify/rate-limit` supports per-route overrides via `config.rateLimit`.
 * This helper provides discoverability and type safety for that pattern.
 *
 * @example
 * ```ts
 * fastify.route({
 *   method: 'POST',
 *   url: '/auth/login',
 *   ...withRateLimit({ max: 5, timeWindow: '1 minute' }),
 *   handler: async (request, reply) => { ... },
 * });
 * ```
 *
 * @example
 * ```ts
 * // Disable rate limiting for a specific route
 * fastify.route({
 *   method: 'GET',
 *   url: '/health',
 *   ...withRateLimit(false),
 *   handler: async (request, reply) => { ... },
 * });
 * ```
 */
export const withRateLimit = (
  options: RateLimitOptions | false,
): { config: { rateLimit: RateLimitOptions | false } } => ({
  config: { rateLimit: options },
});

// --- Tenant-aware rate limiting (Phase 2 prep) ---

/**
 * Rate limit tier definition for subscription-based limits.
 * Each tier maps to a max requests/window pair.
 */
export interface RateLimitTier {
  readonly name: string;
  readonly max: number;
  readonly timeWindow: string;
}

/** Default tiers for SaaS subscription plans. */
export const defaultTiers: Readonly<Record<string, RateLimitTier>> = {
  free: { name: 'free', max: 60, timeWindow: '1 minute' },
  starter: { name: 'starter', max: 200, timeWindow: '1 minute' },
  business: { name: 'business', max: 1000, timeWindow: '1 minute' },
  enterprise: { name: 'enterprise', max: 5000, timeWindow: '1 minute' },
};

/**
 * Per-route rate limit that resolves the limit dynamically from request
 * context (e.g. tenant subscription tier). Spreads into Fastify route options.
 *
 * @param getTier - Callback resolving the tier name or object from the request
 * @param tiers - Tier definitions (defaults to `defaultTiers`)
 *
 * @example
 * ```ts
 * fastify.route({
 *   method: 'POST',
 *   url: '/api/v1/orders',
 *   ...withTenantRateLimit((req) => req.tenant?.plan ?? 'free'),
 *   handler: async (request, reply) => { ... },
 * });
 * ```
 */
export const withTenantRateLimit = (
  getTier: (request: FastifyRequest) => RateLimitTier | string,
  tiers: Readonly<Record<string, RateLimitTier>> = defaultTiers,
): { config: { rateLimit: RateLimitOptions } } => ({
  config: {
    rateLimit: {
      max: (_request, _key) => {
        const tier = getTier(_request as FastifyRequest);
        const resolved = typeof tier === 'string' ? tiers[tier] : tier;
        return resolved?.max ?? 100;
      },
      timeWindow: '1 minute',
    },
  },
});
