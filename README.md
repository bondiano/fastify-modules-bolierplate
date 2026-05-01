# Fastify SaaS Kit

A batteries-included monorepo for building modular Fastify backends. Reusable infrastructure packages compose into running services with auth, authorization, background jobs, and an admin panel out of the box.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js >= 22 |
| Package Manager | pnpm 10 |
| Build Orchestration | Turborepo |
| Framework | Fastify 5 |
| ORM | Kysely (PostgreSQL) |
| Dependency Injection | Awilix + @fastify/awilix |
| Config Validation | Zod 4 |
| Auth | JWT (jose) + Argon2 |
| Authorization | CASL |
| Request/Response Schemas | TypeBox |
| Background Jobs | BullMQ (Redis) |
| Testing | Vitest, PGlite, ioredis-mock |
| Linting | ESLint 10 |

## Getting Started

### Prerequisites

- Node.js >= 22
- pnpm >= 10
- Docker (for PostgreSQL and Redis)

### Setup

**One-shot** (uses the root `Makefile`):

```bash
make setup          # env + install + docker up + migrate
make admin EMAIL=you@example.com PASSWORD=change-me-please-1234
make dev            # API on :3000, admin panel at /admin
```

**Or step by step**:

```bash
cp .env.example .env         # defaults match docker-compose ports
pnpm install
docker compose up -d         # Postgres :5433, Redis :6380
pnpm --filter api db:migrate
pnpm --filter api create-admin --email you@example.com --password change-me-please-1234
pnpm dev
```

Default database credentials: `saaskit` / `saaskit`, database: `saaskit_dev`.
Every `@kit/*` config-schema variable is documented in [`.env.example`](./.env.example).
Run `make help` for the full list of targets.

## Monorepo Structure

```
packages/kit/
  core/          DI container, Fastify server factory, graceful shutdown
  db/            Kysely ORM, transaction proxy, base repositories, migrations
  auth/          Stateless JWT, Argon2 passwords, Redis token blacklist
  authz/         CASL authorization, role-based abilities, route guards
  schemas/       TypeBox schemas, response envelope (ok, paginated), OpenAPI
  errors/        Exception hierarchy, global error handler
  config/        Zod-based config with .env cascade
  jobs/          BullMQ auto-discovery, queue/worker management
  admin/         Admin panel (htmx + Preact SSR), auto-inferred CRUD
  tenancy/       Opt-in multi-tenancy (resolver chain, tenant-scoped repositories, canonical tenants/memberships/invitations migrations)
  eslint-config/ Shared ESLint config
  ts-config/     Shared TypeScript configs
  effect-ts/     Optional Effect integration
  test/          Shared test utilities

services/
  api/           Main backend application
```

## Architecture

### Vertical Slice Modules

Each business module in `services/api/src/modules/<name>/` is self-contained. No cross-module imports. Modules follow a consistent file convention:

| File | Purpose |
| --- | --- |
| `<name>.module.ts` | DI type augmentations |
| `<name>.repository.ts` | Data access (auto-registered) |
| `<name>.service.ts` | Business logic (auto-registered) |
| `<name>.mapper.ts` | DTO transformations (auto-registered) |
| `<name>.route.ts` | HTTP handlers (auto-loaded) |
| `<name>.abilities.ts` | CASL ability definitions |
| `schemas/*.schema.ts` | TypeBox request/response schemas |
| `jobs/**/*.job.ts` | BullMQ background jobs (auto-loaded) |

### Dependency Injection

Awilix with a global `Dependencies` interface. Files matching `*.{repository,service,mapper,client}.{ts,js}` are auto-registered as camelCased singletons. Each module augments `Dependencies` via `declare global`.

### Transaction Proxy

Repositories depend on `Trx<DB>`, never `Kysely<DB>` directly. Queries automatically participate in the nearest `AsyncLocalStorage` transaction or fall through to the root connection pool.

### Response Envelope

All HTTP responses use a `{ data, error }` shape. Use `ok(data)` for single resources and `paginated(items, page, limit, total)` for lists.

### Config

Zod schemas validated at startup. Base schema from `@kit/config`, extended by kit packages and service-level config. Cascade: `.env` -> `.env.{ENVIRONMENT}`.

### Bootstrap Flow

```
main.ts -> createConfig() -> createLogger() -> createDataSource()
  -> createTransactionStorage() -> createContainer() -> createServer()
  -> setupGracefulShutdown() -> server.listen()
```

### Multi-tenancy (`@kit/tenancy`)

The `@kit/tenancy` package is opt-in: register `createTenancyPlugin` in
`createServer` and every protected route resolves a tenant via a resolver
chain (header / cookie / JWT claim / user-default), opens an
`AsyncLocalStorage` frame for that tenant, and lets `tenantScoped()`
repositories transparently inject `WHERE tenant_id = :current` on reads,
auto-stamp it on writes, and refuse cross-tenant updates.

The kit ships canonical migrations for the `tenants`, `memberships`, and
`invitations` tables plus a backfill template (`migrations/_template`) for
retrofitting existing tables with `tenant_id`. `services/api` uses both --
the canonical migrations are copied into `services/api/migrations/`
(timestamps sort after the existing module migrations) and `users`/`posts`
are retrofitted via `add_tenant_id_to_*` migrations that seed a
`Default Workspace` tenant for backfill and add a `(tenant_id, created_at)`
composite index. The `/auth/register` flow creates a personal tenant + an
`owner` membership for every new account, so signup mirrors the SaaS
"private workspace per user" pattern.

See [`packages/kit/tenancy/CLAUDE.md`](./packages/kit/tenancy/CLAUDE.md)
for the full resolver-chain reference, the
`createTenantScopedRepository` API, the invitation event hook, and the
"how to make a module tenant-scoped" recipe.

## Commands

```bash
# Root (all packages via Turbo)
pnpm build          # TypeScript compilation
pnpm dev            # Start all services in watch mode
pnpm lint           # ESLint across all packages
pnpm test           # Vitest across all packages
pnpm check-types    # tsc --noEmit across all packages

# API service
pnpm --filter api dev                    # Dev server with watch mode
pnpm --filter api test                   # Run tests
pnpm --filter api db:migrate             # Run pending migrations
pnpm --filter api db:rollback            # Rollback last migration
pnpm --filter api db:create-migration X  # Scaffold migration named X
pnpm --filter api create-admin           # Create admin user
pnpm --filter api repl                   # REPL with DI container access
```

## Testing

- **Integration tests** per route using `fastify.inject`
- **Unit tests** for services by swapping DI dependencies via `createDependenciesContainer`
- **PGlite** for in-memory PostgreSQL -- no external database needed for tests
- **ioredis-mock** for Redis

```bash
# Run all tests
pnpm test

# Run a single test file
pnpm --filter api exec vitest run path/to/file.test.ts
```

## Adding a New Module

1. Create `services/api/src/modules/<name>/`
2. Add a repository with `createBaseRepository` or `createSoftDeleteRepository`
3. Add a service with business logic
4. Add routes with TypeBox schemas and `export const autoPrefix = '/<name>'`
5. Add CASL abilities if authorization is needed
6. Add a `<name>.module.ts` with `Dependencies` augmentations

See `services/api/CLAUDE.md` for the full file convention table.
