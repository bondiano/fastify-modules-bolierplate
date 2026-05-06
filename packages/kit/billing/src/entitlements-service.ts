/**
 * Entitlements: "is feature X enabled for tenant Y?".
 *
 * Resolution path: tenant -> active subscription -> plan -> plan_features.
 * Tenants without an active subscription get a configurable free-tier
 * fallback (default: no plan, every feature disabled).
 *
 * Cache: per-tenant feature map under `entitlements:${tenantId}` with
 * 5-minute TTL. The `billing.process-event` worker busts on
 * `subscription.activated/updated/canceled`, and admin mutations to
 * `plan_features` bust on commit. Backend-agnostic via the
 * `EntitlementsCache` interface so tests swap with a Map.
 */
import type { FeatureRow, PlanFeaturesRepository } from './plans-repository.js';
import type { BillingDB } from './schema.js';
import type { SubscriptionsRepository } from './subscriptions-repository.js';

export type EntitlementValue =
  | { readonly enabled: boolean }
  | { readonly limit: number }
  | { readonly quotaPerMonth: number }
  | Record<string, unknown>;

export interface EntitlementMap {
  readonly [featureKey: string]: EntitlementValue;
}

export interface EntitlementsCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface EntitlementsService {
  isFeatureEnabled(featureKey: string, tenantId: string): Promise<boolean>;
  getEntitlements(tenantId: string): Promise<EntitlementMap>;
  /** Bust the cache for a tenant. Called by webhook handler on
   * `subscription.{activated,updated,canceled}` and on plan_features
   * admin mutations. */
  invalidate(tenantId: string): Promise<void>;
}

export interface EntitlementsServiceDeps<DB extends BillingDB> {
  readonly subscriptionsRepository: SubscriptionsRepository<DB>;
  readonly planFeaturesRepository: PlanFeaturesRepository;
  readonly cache: EntitlementsCache;
  /** Free-tier feature map applied when the tenant has no active
   * subscription. Defaults to empty (no features). */
  readonly freeTierEntitlements?: EntitlementMap;
  /** Cache TTL in seconds. Defaults to 300 (5 minutes). */
  readonly cacheTtlSeconds?: number;
}

const cacheKey = (tenantId: string): string => `entitlements:${tenantId}`;

export const createEntitlementsService = <DB extends BillingDB>({
  subscriptionsRepository,
  planFeaturesRepository,
  cache,
  freeTierEntitlements = {},
  cacheTtlSeconds = 300,
}: EntitlementsServiceDeps<DB>): EntitlementsService => {
  const resolveFromDb = async (tenantId: string): Promise<EntitlementMap> => {
    const subscription =
      await subscriptionsRepository.findActiveByTenant(tenantId);
    if (!subscription || !subscription.planId) {
      return freeTierEntitlements;
    }
    const planFeatures = await planFeaturesRepository.findByPlanId(
      subscription.planId,
    );
    const map: Record<string, EntitlementValue> = {};
    for (const row of planFeatures) {
      map[row.featureKey] = row.value as EntitlementValue;
    }
    return map;
  };

  const getEntitlements = async (tenantId: string): Promise<EntitlementMap> => {
    const cached = await cache.get(cacheKey(tenantId));
    if (cached) {
      try {
        return JSON.parse(cached) as EntitlementMap;
      } catch {
        // Corrupted cache entry; fall through to DB resolve.
      }
    }
    const fresh = await resolveFromDb(tenantId);
    await cache.set(cacheKey(tenantId), JSON.stringify(fresh), cacheTtlSeconds);
    return fresh;
  };

  return {
    getEntitlements,

    async isFeatureEnabled(featureKey, tenantId) {
      const entitlements = await getEntitlements(tenantId);
      const value = entitlements[featureKey];
      if (!value) return false;
      if ('enabled' in value && typeof value.enabled === 'boolean') {
        return value.enabled;
      }
      // Limit / quota features count as "enabled" if the row exists --
      // the consumer enforces the actual limit elsewhere.
      return true;
    },

    async invalidate(tenantId) {
      await cache.delete(cacheKey(tenantId));
    },
  };
};

// Reserved -- avoids unused import flag for `FeatureRow` while keeping
// the type available for future per-feature resolution helpers.
export type _ReservedFeatureRow = FeatureRow;
