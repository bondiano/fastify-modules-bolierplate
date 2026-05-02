# services/api-single

Minimal Fastify service that demonstrates the kit running **without
`@kit/tenancy`**. A single `notes` module with CRUD over a soft-delete
repository, no tenant frame, no membership checks, no auth. Use it as a
reference for "is the kit usable without multi-tenancy?" -- the answer is
yes, and this service is the proof.

## What's NOT here (vs. `services/api`)

- No `@kit/tenancy` dep, no `createTenancyPlugin`, no `tenant_id` columns,
  no resolver chain, no `request.tenant`.
- No `@kit/auth` / `@kit/authz` / `@kit/admin` / `@kit/jobs`. The point is
  to isolate the tenancy axis -- auth and admin are orthogonal concerns
  that you can layer back in independently.
- Repository uses `createSoftDeleteRepository` from `@kit/db/runtime`
  directly. There is no `tenantContext` dep, no tenant frame requirement,
  and no `unscoped()` escape hatch (because nothing is scoped in the
  first place).

## Directory

```
src/
  config.ts                     App config (db + CORS)
  bin/server.ts                 Entry point -- bootstraps DB, DI, server
  db/
    schema.ts                   Single `notes` table
    cli.ts                      Migration CLI
  server/create.ts              Server factory (kit core + error handler only)
  modules/notes/
    notes.module.ts             Dependencies augmentation
    notes.repository.ts         createSoftDeleteRepository<DB, 'notes'>
    notes.service.ts            Business logic
    notes.mapper.ts             DTO mapper
    notes.route.ts              CRUD routes
    schemas/                    TypeBox schemas
    errors/                     Domain errors
migrations/
  20260502000001_create_notes.ts
```

## Scripts

- `pnpm dev` -- start with `--watch` and `--experimental-strip-types`
- `pnpm test` -- vitest integration suite (uses PGlite)
- `pnpm db:migrate` -- run pending migrations
- `pnpm db:create-migration <name>` -- scaffold a new migration

## Bootstrapping pattern (no tenancy)

```ts
// src/bin/server.ts
const dataSource = createDataSource<DB>({ ... });
const transactionStorage = await createTransactionStorage<DB>();

const container = await createContainer({
  logger,
  config,
  extraValues: { dataSource, transactionStorage }, // <- no tenantStorage / tenantContext
  modulesGlobs: ['.../modules/**/*.{repository,service,mapper,client}.ts'],
  providers: [dbProvider()], // <- no authProvider, no authzProvider
});

const server = await createServer({ config, container, logger });
//          ^ src/server/create.ts -- registers ONLY createErrorHandlerPlugin
```

## When to use this service vs. `services/api`

- Building a single-tenant SaaS, internal tool, B2C product, or a service
  where tenancy is handled at a different layer (e.g. one DB-per-customer).
  Start from `api-single` and grow.
- Building a multi-tenant SaaS where every business entity belongs to a
  tenant. Start from `services/api` -- it has the resolver chain,
  registration flow, and admin tenant switcher already wired.
