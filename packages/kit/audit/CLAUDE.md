# @kit/audit

Append-only audit log for the Fastify SaaS Kit. Ships a canonical
`audit_log` table, a tenant-scoped repository (with a system-level `append`
escape hatch for pre-tenant flows), a per-request `request.audit()`
decorator that buffers entries during the request lifecycle and flushes
them in a single `INSERT` on `onResponse` / `onError`, and a `computeDiff`
+ redaction utility shared with `@kit/admin`'s mutation hook (P2.audit.5,
not yet shipped).

Apps that don't register `createAuditPlugin` pay zero cost.

## Directory

```
src/
  index.ts                    barrel re-exports
  schema.ts                   AuditLogTable + AuditDB (extends @kit/tenancy/schema TenancyDB)
  diff.ts                     computeDiff + redact + DEFAULT_REDACT_PATTERNS
  audit-log-repository.ts     createAuditLogRepository (tenant-scoped reads + append/appendMany/pruneOlderThan/unscoped)
  plugin.ts                   createAuditPlugin + request.audit decorator (buffer + flush)
  *.test.ts                   vitest coverage (fake-trx unit, fastify.inject plugin, PGlite integration)
  fake-trx.test-helpers.ts    shared test helper (excluded from build)

migrations/
  20260503000001_create_audit_log.ts
```

## Key ideas

- **Append-only.** The public surface is `append(entry)` /
  `appendMany(entries)` plus the read side. There is no `update()` /
  `delete()` -- audit history is forensic data, not editable. The
  `pruneOlderThan(cutoff)` system call is the only allowed delete and is
  driven by the retention policy (90 days by default; the
  `audit.prune` BullMQ job lands in P2.audit.6).
- **Buffer + flush.** `request.audit(...)` returns `void` and pushes into
  a per-request buffer. The plugin's `onResponse` (and `onError`) hook
  flushes the buffer in a single batched INSERT, automatically enriching
  every entry with the response status code and the Fastify request id
  as `correlationId`. Handlers don't `await`; audit failure is logged
  but never thrown.
- **System-level append.** The decorator works on `withTenantBypass()`
  routes (signup, password reset) -- `append()` accepts an explicit
  `tenantId` (may be `null`) instead of reading the active tenant frame.
  Listing audit rows from admin still requires a tenant frame because
  the read side composes `createTenantScopedRepository` from
  `@kit/tenancy`.
- **Redaction is layered.** A global `redactPatterns` (`/password/i`,
  `/token/i`, `/secret/i`, `/api[_-]?key/i`, `/hash/i` by default) runs
  on every diff. Per-call `sensitiveColumns` extends the set for that
  one entry. Per-resource `AdminResourceSpec.sensitiveColumns` extends
  it for every entry the admin auto-capture writes against that
  resource.
- **Sensitive flag.** Every redacted entry sets `audit_log.sensitive =
  true` so ops dashboards can filter the firehose without re-running the
  pattern match.

## Admin auto-capture

`@kit/admin`'s create/update/delete routes call `request.audit(...)`
automatically after each successful mutation. Update routes fetch a
`before` snapshot via `repo.findById(id)` so the diff is meaningful;
delete routes record the row that was just removed; create routes
emit `{ after }` only.

Per-resource opt-out: pass `auditEnabled: false` to
`defineAdminResource` for any resource that shouldn't produce audit
rows (e.g. the audit-log resource itself, or hot append-only tables).
Field-level redaction extends `redactPatterns` with each resource's
`AdminResourceSpec.sensitiveColumns`.

## Wiring (in services/api)

The plugin reads `auditLogRepository` from `fastify.diContainer.cradle`
(override via `resolveRepository` if you don't use `@fastify/awilix`).
Register **after** `@kit/auth` (so `request.auth?.sub` is available as
the actor id) and **after** `@kit/tenancy` (so `request.tenant?.tenantId`
is available as the tenant id), **before** `@kit/admin` so admin
mutations land inside the audit-buffered scope.

```ts
// services/api/src/server/create.ts
return createKitServer({
  // ...
  plugins: [
    createErrorHandlerPlugin,
    createAuthPlugin,
    createAuthzPlugin,
    createTenancyPlugin({ ... }),
    createAuditPlugin,                 // <- here
    {
      plugin: createAdminPlugin,
      options: { prefix: '/admin', ... },
    },
  ],
});
```

The consumer service exposes `auditLogRepository` via the standard
auto-discovery convention (`*.repository.ts` -- becomes
`auditLogRepository` in the cradle).

```ts
// services/api/src/modules/audit/audit-log.repository.ts
import { createAuditLogRepository } from '@kit/audit';
import type { Trx } from '@kit/db/runtime';
import type { TenantContext } from '@kit/tenancy';
import type { DB } from '#db/schema.ts';

interface AuditLogRepositoryDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createAuditLogRepository = ({
  transaction,
  tenantContext,
}: AuditLogRepositoryDeps) =>
  factory<DB>({ transaction, tenantContext });
```

Don't reach for `Pick<Dependencies, ...>` -- the standalone `Deps`
interface is the project-wide convention (see
`memory/feedback_no_pick_dependencies.md`).

## Calling `request.audit()`

```ts
// inside a route handler
fastify.post('/posts', async (request, reply) => {
  const post = await postsService.create(request.body);

  request.audit('create', { type: 'Post', id: post.id }, {
    after: post,
  }, { source: 'web-form' });

  return ok(post);
});
```

- The first arg is a free-form `action` string. Convention:
  - `create` / `update` / `delete` for CRUD
  - `auth.login` / `auth.logout` / `auth.password-reset` for auth flows
  - `billing.subscription.canceled` for domain events
- `subject` is `{ type, id }`. `type` is the conceptual model (singular,
  capitalized) -- not the table name. `id` is whatever the consumer uses
  in URLs.
- `diff` is `{ before?, after?, sensitiveColumns? }`. Pass `before:
old, after: new` for updates; just `after` for creates; just `before`
  for deletes. The plugin runs `computeDiff` at call time.
- `metadata` is free-form caller-supplied JSON. The plugin auto-merges
  `{ statusCode, correlationId }` on top.

The decorator is also available on routes marked
`config: { audit: 'bypass' }` -- it just becomes a silent no-op so
handlers don't need to feature-detect.

## Redaction

Default patterns (case-insensitive):

| Pattern         | Matches                          |
| --------------- | -------------------------------- |
| `/password/i`   | `password`, `passwordHash`       |
| `/token/i`      | `accessToken`, `tokenHash`       |
| `/secret/i`     | `apiSecret`, `clientSecret`      |
| `/api[_-]?key/i`| `apiKey`, `api_key`, `api-key`   |
| `/hash/i`       | `passwordHash`, `tokenHash`      |

Override the entire set per-plugin via
`createAuditPlugin({ redactPatterns: [...] })`. Add a one-off override at
the call site via `request.audit('action', subject, { after, sensitiveColumns: ['pin'] })`.

The redaction utility (`redact(value, options)`) is also exposed for
hand-scrubbing arbitrary `metadata` payloads before passing them in.

## Retention

- Default: 90 days, configurable via `AUDIT_RETENTION_DAYS` in the consumer
  service's config schema.
- Driver: a BullMQ repeatable defined in
  `services/api/src/modules/audit/jobs/maintenance/audit-prune.job.ts`
  fires daily at 03:00 UTC and calls
  `auditLogRepository.pruneOlderThan(now - retentionDays)`.
- Mechanism: `pruneOlderThan(cutoff)` issues a single `DELETE ...
RETURNING id` and returns the count. Tenant-frame agnostic (the cron
  runs outside any `withTenant` scope).
- Index `idx_audit_log_created_at` makes the prune a seek, not a scan.

## Gotchas

- **Plugin order matters.** `@kit/audit` reads `request.auth?.sub` and
  `request.tenant?.tenantId` from earlier hooks. Register it *after*
  auth + tenancy, *before* admin / module routes that call
  `request.audit()`.
- **Background jobs run outside the request scope.** The decorator is
  request-bound; for jobs / CLI / cron tasks, call
  `auditLogRepository.append(entry)` directly with the tenant id and
  actor id you've already resolved.
- **Audit failure is silent.** The flush hook logs but never throws --
  losing an audit row must not break the response. Pair the kit with a
  dashboard alert on the log line `'@kit/audit: failed to persist audit
entries'` if you care about coverage.
- **Cross-tenant search.** `auditLogRepository.unscoped()` is the
  escape hatch for system-admin views. Forgetting to call it from
  cross-tenant code returns an empty list (the scoped read injects
  `WHERE tenant_id = :current` and there's no tenant frame).
- **`sensitive` is the audit-row flag, not a config.** Per-resource
  `AdminResourceSpec.sensitiveColumns` (consumed by the admin
  auto-capture hook) extends the redaction list. The
  `audit_log.sensitive` boolean is set by the diff utility when any
  field was redacted, regardless of which override caused it.

## Conventions

- Audit history is forensic; never expose `update`/`delete` from the
  repository's public surface. `pruneOlderThan` is the single
  authorized delete path.
- The schema's `subject_id` is `text` (not `uuid`) so future packages
  can audit non-UUID subjects (Stripe customer ids, slugs, composite
  keys) without a migration.
- `tenant_id` and `actor_id` use `ON DELETE SET NULL` so a hard tenant
  / user delete preserves the audit trail. Soft deletes (the common
  case) leave the FKs intact.
- Never call `audit()` for read events on hot endpoints unless you've
  measured -- the buffered flush is cheap, but the JSON serialization
  isn't free at scale.
