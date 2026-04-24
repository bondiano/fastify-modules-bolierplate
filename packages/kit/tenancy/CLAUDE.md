# @kit/tenancy

Opt-in multi-tenancy plugin for the Fastify SaaS Kit. Adds a tenant resolver
chain, an `AsyncLocalStorage`-backed `TenantContext`, and a `tenantScoped()`
repository reshape on top of `@kit/db`'s `BaseRepository`. Apps that don't
register `createTenancyPlugin` pay zero cost.

> **Status:** in progress. Context primitives + errors landed in `P2.tenancy.3`;
> resolver chain, repository reshape, and Awilix provider are still stubs --
> each section below tagged `TODO (P2.tenancy.X)` is filled in by that task.
> See `docs-ai/ROADMAP.md §2a` for the full spec.

## Directory

```
src/
  index.ts         barrel re-exports
  context.ts       TenantStorage + createTenantContext (withTenant / currentTenant / assertTenant)
  errors.ts        TenantNotResolved (400) + CrossTenantAccess (403)
  context.test.ts  unit coverage for the context + error mapping
```

Planned additions:

```
src/
  resolvers.ts     fromHeader / fromSubdomain / fromJwtClaim / fromUserDefault (P2.tenancy.4)
  plugin.ts        createTenancyPlugin (P2.tenancy.4)
  repository.ts    tenantScoped() reshape of BaseRepository (P2.tenancy.5)
  provider.ts      Awilix provider for tenancy-owned singletons (P2.tenancy.8)
```

## Key ideas

- **Opt-in, never hard-wired.** The plugin is registered explicitly via
  `createTenancyPlugin` -- single-tenant services skip it and nothing
  downstream notices. (Resolution of `P2.B1`; see ROADMAP changelog.)
  `TODO (P2.tenancy.4)`
- **Shared DB + `tenant_id` column, forever.** Per-tenant databases are a
  PRD §12 non-goal. Isolation is row-level via the `tenantScoped()`
  repository reshape + a single `AsyncLocalStorage` slot. (Resolution of
  `P2.B2`.) `TODO (P2.tenancy.5)`
- **AsyncLocalStorage mirrors `Trx`.** `createTenantStorage()` is the only
  place that imports `node:async_hooks` -- same guarantee as
  `@kit/db`'s `createTransactionStorage`. Multiple instances silently break
  propagation under vitest's module isolation. `createTenantContext({ tenantStorage })`
  hands back `{ withTenant, currentTenant, tryCurrentTenant, assertTenant }`;
  the resolver chain or job runner sets the frame and any downstream code
  reads it without manual threading.
- **Human-readable tenant names.** `tenants.name` is required and displayed
  everywhere a user sees the tenant (switcher, invitations, receipts).
  `tenants.slug` is auto-derived via slugify + numeric-suffix collision
  resolution and is what appears in URLs / subdomains. Never show `slug`
  where `name` fits. `TODO (P2.tenancy.8)`

## Resolver order

Resolvers run in declaration order; the first one that yields a `tenantId`
wins. Built-ins shipped in `P2.tenancy.4`:

1. `fromHeader('x-tenant-id')` -- explicit header override, primarily for
   API clients. `TODO (P2.tenancy.4)`
2. `fromSubdomain()` -- extracts slug from `acme.example.com`. `TODO (P2.tenancy.4)`
3. `fromJwtClaim('tenant_id')` -- reads the claim populated by
   `@kit/auth`'s tokens. `TODO (P2.tenancy.4)`
4. `fromUserDefault()` -- falls back to the user's default membership
   (set during signup). `TODO (P2.tenancy.4)`

Custom resolvers implement `TenantResolver = (req) => Promise<string | null>`.
Add them when registering the plugin:

```ts
// TODO (P2.tenancy.4): real example once resolver types exist
```

## Reading the active tenant

```ts
import { createTenantContext, createTenantStorage } from '@kit/tenancy';

const tenantStorage = await createTenantStorage();
const tenants = createTenantContext({ tenantStorage });

await tenants.withTenant('acme', async () => {
  tenants.currentTenant().tenantId; // 'acme' -- throws TenantNotResolved if no frame
  tenants.tryCurrentTenant(); // { tenantId: 'acme' } | null -- non-throwing read
  tenants.assertTenant('acme'); // throws CrossTenantAccess if mismatch
});
```

## Wiring sketch (in services/api)

```ts
// main.ts
// TODO (P2.tenancy.4)
// import { createTenancyPlugin, fromHeader, fromSubdomain, fromJwtClaim, fromUserDefault } from '@kit/tenancy';
//
// await server.register(createTenancyPlugin({
//   resolverOrder: [fromHeader('x-tenant-id'), fromSubdomain(), fromJwtClaim('tenant_id'), fromUserDefault()],
// }));
```

## How to make a module tenant-scoped

Three mechanical steps, all covered by the backfill template shipped in
`P2.tenancy.6`:

1. **Add `tenant_id uuid NOT NULL` + FK** via the migration template at
   `@kit/tenancy/migrations/_template`. `TODO (P2.tenancy.6)`
2. **Swap the repository's base** from `BaseRepository<DB, T>` to
   `tenantScoped(BaseRepository<DB, T>)` (or the soft-delete variant). All
   reads/writes automatically gain a `WHERE tenant_id = :current` filter.
   `TODO (P2.tenancy.5)`
3. **Update CASL abilities** to condition on `membership` rather than just
   `user`. `defineAbilities` receives the resolved membership alongside
   the user. `TODO (P2.tenancy.9)`

Worked example (retrofitting `users` + `posts`) lives in `P2.tenancy.14`.

## Writing tenant-aware migrations

`@kit/tenancy/migrations/_template` ships a `Kysely.Migration` helper that:

- adds the `tenant_id` column `NOT NULL` with a default tenant for backfill
- creates a composite index on `(tenant_id, <natural sort column>)`
- drops the default after backfill to enforce explicit writes

`TODO (P2.tenancy.6)` -- wire the template, document when to reach for
`unscoped()` during a data migration.

## Gotchas

- **Background jobs run outside the request scope.** The resolver chain
  never fires for a BullMQ worker, so the `AsyncLocalStorage` slot is empty.
  Wrap handlers in `tenants.withTenant(tenantId, () => handler(job))` --
  same ergonomics as `@kit/db`'s `runInTransaction`. Reading
  `currentTenant()` outside any `withTenant` frame throws
  `TenantNotResolved` (HTTP 400 when it escapes a route).
- **Admin cross-tenant queries need `unscoped()`.** System-admin views (the
  tenant list itself, cross-tenant analytics) must explicitly opt out of
  the row filter. Forgetting to do so returns an empty list, not an error.
  `TODO (P2.tenancy.5)`
- **Signup has no tenant yet.** The `POST /auth/register` handler runs
  before any tenant exists -- mark the route as `tenant: 'bypass'` (or
  equivalent) so the plugin skips resolution and `currentTenant()` is
  never called from that route. Without the bypass marker, the plugin will
  throw `TenantNotResolved` (400). `TODO (P2.tenancy.4)`

## Conventions

- Never import `@kit/tenancy` from `@kit/db`, `@kit/auth`, `@kit/authz`, or
  `@kit/errors`. The direction is always `tenancy -> them`.
- Never branch business logic on "is tenancy enabled?" -- if a module needs
  tenancy it must declare the dep; if it doesn't, it stays ignorant of
  tenants entirely.
- `tenants.name` is a required display string. `tenants.slug` is derived
  and used in URLs. Treat them as two independent fields; do not show the
  slug anywhere a user sees the tenant.
