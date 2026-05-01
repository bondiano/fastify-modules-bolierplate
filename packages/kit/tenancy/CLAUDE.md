# @kit/tenancy

Opt-in multi-tenancy plugin for the Fastify SaaS Kit. Adds a tenant resolver
chain, an `AsyncLocalStorage`-backed `TenantContext`, and a `tenantScoped()`
repository reshape on top of `@kit/db`'s `BaseRepository`. Apps that don't
register `createTenancyPlugin` pay zero cost.

## Directory

```
src/
  index.ts                      barrel re-exports
  context.ts                    TenantStorage + createTenantContext (withTenant / currentTenant / assertTenant)
  errors.ts                     TenantNotResolved (400) + CrossTenantAccess (403) + MembershipRequired (403) + domain errors (TenantNotFound, MembershipNotFound, MembershipExists, InvitationEmailMismatch, ...)
  resolvers.ts                  TenantResolver type + fromHeader / fromCookie / fromSubdomain / fromSubdomainBySlug / fromJwtClaim / fromUserDefault
  plugin.ts                     createTenancyPlugin + withTenantBypass + fastify.{withTenant,currentTenant} + request.tenant
  repository.ts                 createTenantScopedRepository + createTenantScopedSoftDeleteRepository + unscoped()
  schema.ts                     TenantsTable / MembershipsTable / InvitationsTable + TenancyDB contract
  tenants-repository.ts         createTenantsRepository (system-level soft-delete + findBySlug)
  memberships-repository.ts     createMembershipsRepository (tenant-scoped + user-keyed cross-tenant reads)
  invitations-repository.ts     createInvitationsRepository (tenant-scoped + findByTokenHash unscoped)
  tenants-service.ts            createTenantsService (slug derivation + collision resolution)
  memberships-service.ts        createMembershipsService (invite / accept / revoke / regenerate + InvitationCreated event)
  slugify.ts                    slugify helper (NFKD + ASCII fallback + 63-char cap)
  invitation-template.ts        renderInvitationEmail (placeholder until P2.mailer.*)
  fake-trx.test-helpers.ts      shared test helper (excluded from build)
  integration.test.ts           PGlite-backed cross-tenant isolation tests
  *.test.ts                     vitest coverage for every public unit

migrations/
  20260424000001_create_tenants.ts
  20260424000002_create_memberships.ts
  20260424000003_create_invitations.ts
  _template/
    YYYYMMDDHHMMSS_add_tenant_id_to__TABLE_.ts    backfill template for retrofitting existing tables
```

## Invitation event + email template

`createMembershipsService` accepts an optional
`onInvitationCreated` handler in its deps. After every successful
`invite()`, the service awaits the handler with an
`InvitationCreatedEvent`:

```ts
interface InvitationCreatedEvent {
  invitationId: string;
  tenantId: string;
  email: string;
  role: string;
  /** Raw token -- emitted exactly once, never persisted (DB stores sha256 only). */
  token: string;
  expiresAt: Date;
  invitedBy: string | null;
}
```

The package ships a placeholder template at
`@kit/tenancy/invitation-template`. Real delivery lands in
`P2.mailer.*`; for now, the consumer wires a mock adapter that calls
`renderInvitationEmail(event, { acceptUrl, tenantName })` and forwards
`{ to, subject, text, html }` wherever it likes (console log, captured
test buffer, ...). When `P2.mailer.*` ships the kit will publish a
ready-made adapter that reads the same shape.

```ts
// services/api/src/server/main.ts (sketch)
import { renderInvitationEmail } from '@kit/tenancy/invitation-template';

const onInvitationCreated = async (event) => {
  const message = renderInvitationEmail(event, {
    acceptUrl: `${config.PUBLIC_URL}/auth/invite`,
    tenantName: await getTenantName(event.tenantId),
    productName: config.APP_NAME,
  });
  await mailer.send(message); // P2.mailer.* swap
};
```

Handler errors propagate -- the invitation row is already committed by
the time the event fires, so handlers should swallow non-fatal
failures themselves and log.

`membershipsService.regenerate(invitationId, { expiresInMs? })` mints a
fresh token + extended expiry on an existing pending invitation row and
re-fires the same `InvitationCreatedEvent` so a wired mailer adapter
re-sends the accept link automatically. The kit's reference admin UI
binding -- `services/api/src/modules/tenancy/invitations.admin.ts` plus
the `POST /admin/invitations/:id/regenerate` route in
`services/api/src/server/admin-actions.plugin.ts` -- shows the wiring
for an admin "Resend invitation" button. Throws `InvitationNotFound`
on unknown / cross-tenant ids and `InvitationAlreadyAccepted` on
redeemed rows.

### Invitation safety invariants

`accept({ token, userId })` enforces three invariants inside a single
DB transaction:

1. **Email match.** The accepting user's canonical email (from the
   injected `resolveUserEmail` callback, typically wired to
   `usersRepository.findByIdGlobally(...).email`) must equal the
   invitation's email after `trim().toLowerCase()`. Mismatch throws
   `InvitationEmailMismatch` (HTTP 403). Without this check a leaked
   token could be redeemed under a different account.
2. **Atomic gate.** `invitationsRepository.markAccepted(id)` is the
   gate. Its WHERE clause filters `accepted_at IS NULL AND
   expires_at > now() AND deleted_at IS NULL`, so two concurrent
   accepts cannot both succeed -- the loser sees `undefined` from
   `markAccepted` and the service raises `InvitationAlreadyAccepted`
   (or `InvitationExpired` when the token also crossed its expiry).
3. **Idempotent membership.** When the user already has a live
   membership in the target tenant, `accept` returns the existing row
   instead of creating a duplicate.

`invite({ email })` normalizes the email and dedupes:

- If `resolveUserIdByEmail` is wired and the email already maps to an
  active member, it throws `MembershipExists` instead of issuing an
  invitation.
- If a pending (not accepted, not expired, not soft-deleted)
  invitation already exists for the same email in the current tenant,
  it regenerates the existing row (new token, new expiry) instead of
  creating a parallel row with a competing token.

## Key ideas

- **Opt-in, never hard-wired.** The plugin is registered explicitly via
  `createTenancyPlugin` -- single-tenant services skip it and nothing
  downstream notices. (Resolution of `P2.B1`; see ROADMAP changelog.)
- **Shared DB + `tenant_id` column, forever.** Per-tenant databases are a
  PRD §12 non-goal. Isolation is row-level via
  `createTenantScopedRepository` (§ "Tenant-scoped repositories" below) +
  a single `AsyncLocalStorage` slot. (Resolution of `P2.B2`.)
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
  where `name` fits. Both `tenantsService.create` and `slugify` enforce
  the convention.

## Resolver order

Resolvers run in declaration order; the first non-null result wins.
Built-ins (`@kit/tenancy`):

1. `fromHeader('x-tenant-id')` -- explicit header override, primarily for
   API clients. **Unverified** -- pair with `resolveMembership` (below).
2. `fromCookie('admin_tenant')` -- cookie set by the admin tenant
   switcher (or any other UI). Requires `@fastify/cookie` so
   `request.cookies` is populated; without it the resolver returns null
   and the chain continues. Pair this with `fromUserDefault` so a fresh
   visitor without a cookie still resolves to their default tenant.
   **Unverified** -- the cookie value comes from the user-controlled
   request; pair with `resolveMembership`.
3. `fromSubdomain({ ignore: ['www'] })` -- extracts the leftmost label from
   `acme.example.com` and returns it verbatim. **Only safe when the
   tenant id is the slug itself.** When the id is a UUID, use
   `fromSubdomainBySlug({ resolveTenantId })` instead -- it converts
   slug -> uuid via a consumer-supplied lookup so the chain emits the
   canonical id.
4. `fromJwtClaim('tenant_id')` -- reads the claim from `request.auth`.
   Returns null until `@kit/auth` surfaces the field on `AccessTokenPayload`
   (deliberately decoupled). **Verify the claim ↔ membership coupling at
   issue time, or pair with `resolveMembership`.**
5. `fromUserDefault({ resolveDefaultTenant, getUserId? })` -- falls back
   to the user's default membership. The lookup is injected so this
   package stays independent of `@kit/db` / users repository.
   `getUserId` defaults to `request.auth?.sub` and can be overridden if
   your auth surface puts the user id elsewhere. This resolver is
   *self-verifying*: it reads from a backend store keyed on the
   authenticated user, so its output never needs an extra membership
   check.

### Membership verification (`resolveMembership`)

The header / cookie / subdomain / JWT-claim resolvers all read
**user-controlled input**. Without verification, an attacker logged into
tenant A can send `X-Tenant-ID: <tenant-B-uuid>` and any subsequent
write inside the request will stamp `tenant_id = B`. This is a
write-side cross-tenant injection.

`createTenancyPlugin` accepts a `resolveMembership({ tenantId, userId })`
callback that closes the hole. It runs in `onRequest` AFTER the resolver
chain succeeds and BEFORE the AsyncLocalStorage frame opens. Returning
`null` aborts the request with HTTP 403 `MembershipRequired`; returning
`{ role }` populates `request.membership` for `@kit/authz` to read.

The plugin **logs a warning at register time** when `resolveMembership`
is missing -- treat it as an error in any service that exposes
client-controlled tenant resolvers. Skip it only if every resolver in
the chain is self-verifying (e.g. only `fromUserDefault`).

```ts
createTenancyPlugin({
  resolverOrder: [
    fromHeader('x-tenant-id'),
    fromCookie('__Host-admin_tenant'),
    fromUserDefault({ resolveDefaultTenant }),
  ],
  resolveMembership: async ({ tenantId, userId }) => {
    const m = await membershipsRepository.findByUserAndTenant(
      userId,
      tenantId,
    );
    return m ? { tenantId: m.tenantId, role: m.role } : null;
  },
});
```

The check fires only when `request.auth?.sub` (or whatever the
configured `getUserId` returns) is present -- pre-auth requests
silently skip it. Guard pre-tenant routes with `withTenantBypass()` if
they don't need a tenant frame at all.

Custom resolvers implement
`TenantResolver = (req: FastifyRequest) => Promise<string | null> | string | null`.

```ts
import type { TenantResolver } from '@kit/tenancy';

const fromQueryParam = (key: string): TenantResolver => (request) => {
  const value = (request.query as Record<string, string | undefined>)[key];
  return value ?? null;
};
```

## Reading the active tenant

```ts
import { createTenantContext, createTenantStorage } from '@kit/tenancy';

const tenantStorage = createTenantStorage();
const tenants = createTenantContext({ tenantStorage });

await tenants.withTenant('acme', async () => {
  tenants.currentTenant().tenantId; // 'acme' -- throws TenantNotResolved if no frame
  tenants.tryCurrentTenant(); // { tenantId: 'acme' } | null -- non-throwing read
  tenants.assertTenant('acme'); // throws CrossTenantAccess if mismatch
});
```

Inside a request, the same value is reachable as
`request.tenant?.tenantId` (set in `onRequest` by the plugin -- available
to every hook scheduled after tenancy) and via
`fastify.currentTenant()` from inside the route handler (the
AsyncLocalStorage frame opens in `preHandler` and persists through the
handler).

## Wiring sketch (in services/api)

The plugin reads `tenantStorage` and `tenantContext` from
`fastify.diContainer.cradle` (override via `resolveTenantStorage` /
`resolveTenantContext` if you don't use `@fastify/awilix`). Both are
infra values, so create them in `main.ts` and pass through `extraValues`.

`fromCookie('__Host-admin_tenant')` is paired with the `@kit/admin`
tenant switcher. For the resolver to find the cookie at the global
request layer, `@fastify/cookie` must be registered **before**
`createTenancyPlugin` -- `@kit/admin` registers it inside its own
prefix scope, which is too late for the root resolver chain. The
boilerplate registers cookie at the root (see
`services/api/src/server/create.ts`); `@kit/admin` detects the
existing `setCookie` decorator and skips its inner registration to
avoid a Fastify "decorator already added" error.

```ts
// main.ts
import {
  createTenancyPlugin,
  createTenantContext,
  createTenantStorage,
  fromCookie,
  fromHeader,
  fromJwtClaim,
  fromSubdomain,
  fromUserDefault,
  type TenantContext,
  type TenantStorage,
} from '@kit/tenancy';

declare global {
  interface Dependencies {
    tenantStorage: TenantStorage;
    tenantContext: TenantContext;
  }
}

const tenantStorage = createTenantStorage();
const tenantContext = createTenantContext({ tenantStorage });

const container = await createContainer({
  // ...
  extraValues: { tenantStorage, tenantContext },
});

await createServer({
  // ...
  plugins: [
    createAuthPlugin,
    createTenancyPlugin({
      resolverOrder: [
        fromHeader('x-tenant-id'),
        // Pairs with the @kit/admin tenant switcher. The cookie is set
        // and read with the literal `__Host-` prefix; the prefix is
        // part of the cookie name (RFC 6265bis), not stripped by parsers.
        fromCookie('__Host-admin_tenant'),
        fromSubdomain(),
        fromJwtClaim('tenant_id'),
        fromUserDefault({
          resolveDefaultTenant: (userId) =>
            container.cradle.usersRepository.findDefaultTenantId(userId),
        }),
      ],
      // STRONGLY RECOMMENDED -- closes the X-Tenant-ID / cookie / JWT-
      // claim spoofing hole. See "Membership verification" above.
      resolveMembership: async ({ tenantId, userId }) => {
        const m =
          await container.cradle.membershipsRepository.findByUserAndTenant(
            userId,
            tenantId,
          );
        return m ? { tenantId: m.tenantId, role: m.role } : null;
      },
    }),
  ],
});
```

### Bypassing tenant resolution on a route

```ts
import { withTenantBypass } from '@kit/tenancy';

fastify.route({
  method: 'POST',
  url: '/auth/register',
  ...withTenantBypass(),
  handler: registerHandler, // request.tenant is undefined; do not call currentTenant()
});
```

`withTenantBypass(existingConfig?)` accepts an optional config object
that gets merged with the bypass marker, so it composes with other
route-level config (e.g. rate limiting):

```ts
fastify.route({
  method: 'POST',
  url: '/auth/register',
  ...withTenantBypass({ rateLimit: { max: 5, timeWindow: '1 minute' } }),
  handler: registerHandler,
});
```

## Tenant-scoped repositories

```ts
import {
  createTenantScopedRepository,
  createTenantScopedSoftDeleteRepository,
} from '@kit/tenancy';
import type { DB } from '#db/schema.ts';

interface MembershipsRepoDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createMembershipsRepository = ({
  transaction,
  tenantContext,
}: MembershipsRepoDeps) => {
  const base = createTenantScopedRepository<DB, 'memberships'>({
    transaction,
    tenantContext,
    tableName: 'memberships',
  });
  return { ...base /* plus bespoke reads keyed on tenant_id */ };
};
```

- Reads inject `WHERE tenant_id = :current`. Count queries are scoped too,
  so pagination totals match the filtered set.
- `create()` stamps `tenant_id = :current` onto the insert values. The
  public type forbids passing `tenantId` (it's `Omit<Insertable<...>,
  'tenantId'>`); the runtime also strips the column defensively.
- `update()` is scoped to the current tenant **and** strips any
  `tenantId` from the payload at runtime, so an attacker inside tenant
  A cannot rewrite a row to tenant B even by bypassing the type system.
- `deleteById()` is scoped to the current tenant, so a cross-tenant id
  returns `undefined` instead of silently succeeding.
- Tenant resolution is **lazy** and happens per-call. Calling a repository
  method outside any `withTenant` frame throws `TenantNotResolved` at the
  call site, not at repository construction.
- Use `createTenantScopedSoftDeleteRepository` for tables with a
  `deleted_at` column. It layers the tenant filter on top of the normal
  `deletedAt IS NULL` filter and exposes tenant-scoped `softDelete` /
  `restore` / `hardDeleteById` / `findByIdIncludingDeleted`.
- Both factories return an `unscoped()` escape hatch that yields the
  underlying unfiltered repository -- use it **only** from system-admin
  views, cross-tenant analytics, and data migrations. Forgetting to call
  `unscoped()` in those contexts returns an empty list once `tenant_id`
  is NOT NULL, not an error.
- Default tenant column is `tenantId`. Pass `tenantColumn: 'tenant_id'`
  to `createTenantScopedRepository` if your table uses snake_case at the
  runtime layer (the generated Kysely `DB` type usually camelCases it).

## Domain repositories

`@kit/tenancy` ships three ready-made repositories for the canonical
tenancy tables. Consumers whose generated `DB` extends `TenancyDB` from
`@kit/tenancy/schema` can drop them straight into a provider.

```ts
import {
  createTenantsRepository,
  createMembershipsRepository,
  createInvitationsRepository,
  type TenancyDB,
} from '@kit/tenancy';
import type { DB } from '#db/schema.ts'; // must extend TenancyDB
```

### `tenantsRepository`

Not tenant-scoped on purpose -- the `tenants` table governs tenants
themselves, so filtering by the active frame would return nothing. Callers
are responsible for authorization (see `P2.tenancy.9`).

- Soft-delete base (`findById`, `create`, `update`, `deleteById` = soft,
  `softDelete`, `restore`, `hardDeleteById`, `findByIdIncludingDeleted*`).
- `findBySlug(slug)` / `findBySlugIncludingDeleted(slug)` for URL-based
  lookups.

### `membershipsRepository`

Tenant-scoped reads + writes via `createTenantScopedRepository`, plus two
**cross-tenant** reads for flows that run before any tenant frame exists:

- Scoped: `findById`, `findByUserIdInCurrentTenant`, `markJoinedByUserId`,
  the standard `create` / `update` / `deleteById` (all filter by the active
  tenant).
- Cross-tenant: `findAllForUser(userId)`, `findDefaultForUser(userId)` --
  intended for `fromUserDefault` resolution, user-profile pages, etc.
  These do not require an active tenant frame.

`findDefaultForUser` picks the oldest accepted membership (earliest
`joinedAt IS NOT NULL`). Wire it into the resolver chain like this:

```ts
fromUserDefault({
  resolveDefaultTenant: async (userId) => {
    const membership = await membershipsRepository.findDefaultForUser(userId);
    return membership?.tenantId ?? null;
  },
}),
```

### `invitationsRepository`

Tenant-scoped with one cross-tenant lookup for the acceptance flow:

- Scoped: `findPendingByEmail(email)` (pending = not accepted + not
  expired), `markAccepted(id)`, standard `create`/`update`/`deleteById`.
- Cross-tenant: `findByTokenHash(tokenHash)` -- the accepting user has a
  token but no tenant frame. The service layer opens the frame for
  `invitation.tenantId` before any other scoped call.

```ts
// invitation accept flow (sketch -- service lives in P2.tenancy.8)
const invitation = await invitationsRepository.findByTokenHash(tokenHash);
if (!invitation) throw new InvitationNotFound();
// ...validate not expired / not accepted...
await fastify.withTenant(invitation.tenantId, async () => {
  await membershipsRepository.create({ userId, role: invitation.role, invitedBy: invitation.invitedBy, joinedAt: null });
  await invitationsRepository.markAccepted(invitation.id);
});
```

All three factories take standalone `<Name>RepositoryDeps` interfaces
(`transaction`, plus `tenantContext` for the scoped ones); they do not
reference the global `Dependencies` type.

## How to make a module tenant-scoped

1. **Add `tenant_id uuid NOT NULL` + FK** via the backfill migration at
   `@kit/tenancy/migrations/_template` (see "Writing tenant-aware
   migrations" below).
2. **Swap the repository's base** to `createTenantScopedRepository` (or
   `createTenantScopedSoftDeleteRepository`) and add `tenantContext` to
   its deps. All reads/writes automatically gain a
   `WHERE tenant_id = :current` filter. Expose the `unscoped()` escape
   hatch from your repo only if a real cross-tenant flow needs it
   (auth/login, system admin).
3. **Update CASL abilities** to condition on `membership` rather than just
   `user`. `defineAbilities` receives the resolved membership alongside
   the user. The user-level `admin` role still short-circuits to
   `manage all` regardless of tenant role.

Worked example -- retrofitting `users` + `posts` in `services/api`:

- `services/api/migrations/20260424000004_add_tenant_id_to_users.ts` --
  seeds a `Default Workspace` tenant, adds `tenant_id` + FK, backfills
  every existing user, flips to `NOT NULL`, then seeds a membership
  (`role = owner` for `users.role = admin`, `member` otherwise).
- `services/api/migrations/20260424000005_add_tenant_id_to_posts.ts` --
  join-driven backfill via `posts.author_id -> users.tenant_id` (every
  user has a tenant by then) before flipping to `NOT NULL`.
- `services/api/src/modules/users/users.repository.ts` -- composes
  `createTenantScopedRepository<DB, 'users'>` and exposes unscoped
  `findByEmail` / `findByIdGlobally` / `findDefaultTenantId` for the
  auth flow (login + JWT verification + the `fromUserDefault` resolver).
- `services/api/src/modules/posts/posts.repository.ts` -- composes
  `createTenantScopedSoftDeleteRepository<DB, 'posts'>` and rewrites
  `findFiltered` to scope both the list and the count legs by
  `tenant_id`.
- `services/api/src/modules/auth/registration-store.ts` -- a
  `UserStore` adapter that, on every `register`, creates a personal
  tenant via `tenantsService.create({ name: email })` and an `owner`
  membership for the new user inside a single transaction.
- `services/api/src/server/create.ts` -- registers
  `createTenancyPlugin` with the resolver chain (`fromHeader`,
  `fromCookie('admin_tenant')`, `fromJwtClaim('tenant_id')`,
  `fromUserDefault`) and a tiny `best-effort-auth.plugin.ts` that
  populates `request.auth` before tenancy resolves so
  `fromJwtClaim`/`fromUserDefault` can read it.

The admin panel auto-detects `tenant_id` columns and infers
`tenantScoped: true` + `scope: 'tenant'` in `inferSpec`. The resource
overrides in `users.admin.ts` and `posts.admin.ts` need no extra
flag; tenant filtering happens in the underlying scoped repositories.

## Writing tenant-aware migrations

`packages/kit/tenancy/migrations/` ships the canonical tables plus a
retrofit template. `@kit/db/cli`'s migrator reads a single folder, so
services adopting tenancy copy these files into their own `migrations/`
directory -- the timestamp prefix (`20260424...`) is intentionally chosen
to sort strictly after the boilerplate's existing module migrations, so
the FK from `memberships.user_id -> users.id` lines up. `services/api`
demonstrates the copy: see `services/api/migrations/20260424000001..3*.ts`.

**Bundled migrations:**

- `20260424000001_create_tenants.ts` -- `id`, `slug` unique, `name` NOT
  NULL, `created_at`, `updated_at`, `deleted_at` (soft-deletable).
  Partial index on `deleted_at` (only soft-deleted rows).
- `20260424000002_create_memberships.ts` -- `id`, `tenant_id` FK,
  `user_id` FK, `role`, `invited_by`, `joined_at`, `created_at`,
  `deleted_at`. **Partial unique index** `(tenant_id, user_id) WHERE
  deleted_at IS NULL` so a revoked membership leaves the pair free
  for a future re-invite (a plain UNIQUE would block re-joining).
- `20260424000003_create_invitations.ts` -- `id`, `tenant_id` FK,
  `email`, `role`, `token_hash` unique, `invited_by`, `expires_at`,
  `accepted_at`, `created_at`, `deleted_at`. Partial index
  `(tenant_id, email) WHERE accepted_at IS NULL AND deleted_at IS
  NULL` powers the hot `findPendingByEmail` lookup.

Cascade is implemented at two layers:

1. **Foreign keys** still declare `ON DELETE CASCADE` so a *physical*
   tenant DELETE drops its child rows. This rarely fires in production
   (everything is soft-deleted) but matters for cleanup jobs and
   testing.
2. **`tenantsService.softDelete(id)`** runs inside a single
   transaction and stamps `deleted_at` onto every membership +
   invitation in the tenant. Without this layer, soft-deleting a
   tenant would leave ghost memberships visible via `unscoped()` reads
   and via cross-tenant lookups like `findDefaultForUser`. All
   cross-tenant reads in `memberships-repository.ts` /
   `invitations-repository.ts` filter `deleted_at IS NULL` so a
   revoked or tenant-deleted row never leaks back into the resolver
   chain.

`invited_by` keeps a nullable FK with `ON DELETE SET NULL` so revoking
a user does not erase historical rows.

**Backfill template** (`migrations/_template/YYYYMMDDHHMMSS_add_tenant_id_to__TABLE_.ts`)
retrofits existing tables in three safe steps:

1. Add `tenant_id uuid` nullable with a default pointing at a seed tenant.
2. `UPDATE ... SET tenant_id = ...` to backfill existing rows. Swap the
   single-default `UPDATE` for a join-driven one when every row already
   maps to a tenant through some natural key (e.g. author -> membership).
3. Flip the column to `NOT NULL`, drop the default, and add a composite
   `(tenant_id, created_at)` index.

During step 2, read queries must use `unscoped()` -- the tenant frame is
not yet meaningful.

## Gotchas

- **Background jobs run outside the request scope.** The resolver chain
  never fires for a BullMQ worker, so the `AsyncLocalStorage` slot is empty.
  Wrap handlers in `tenants.withTenant(tenantId, () => handler(job))` --
  same ergonomics as `@kit/db`'s `runInTransaction`. Reading
  `currentTenant()` outside any `withTenant` frame throws
  `TenantNotResolved` (HTTP 400 when it escapes a route).
- **Admin cross-tenant queries need `unscoped()`.** System-admin views (the
  tenant list itself, cross-tenant analytics) must explicitly opt out of
  the row filter via `repo.unscoped()`. Forgetting to do so returns an
  empty list, not an error.
- **Signup has no tenant yet.** The `POST /auth/register` handler runs
  before any tenant exists -- spread `withTenantBypass()` into the route
  definition so the plugin skips resolution. Without the bypass marker,
  `onRequest` throws `TenantNotResolved` (400) before the handler runs.

## Conventions

- Never import `@kit/tenancy` from `@kit/db`, `@kit/auth`, `@kit/authz`, or
  `@kit/errors`. The direction is always `tenancy -> them`.
- Never branch business logic on "is tenancy enabled?" -- if a module needs
  tenancy it must declare the dep; if it doesn't, it stays ignorant of
  tenants entirely.
- `tenants.name` is a required display string. `tenants.slug` is derived
  and used in URLs. Treat them as two independent fields; do not show the
  slug anywhere a user sees the tenant.
