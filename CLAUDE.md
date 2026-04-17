# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fastify SaaS Kit -- a pnpm monorepo with Turbo for building modular Fastify backends. Kit packages (`packages/kit/*`) provide reusable infrastructure; services (`services/*`) compose them into running applications.

## Commands

### Root (runs across all packages via Turbo)

```bash
pnpm build          # TypeScript compilation
pnpm dev            # Start all services in watch mode
pnpm lint           # ESLint across all packages
pnpm test           # Vitest across all packages
pnpm check-types    # tsc --noEmit across all packages
```

### services/api

```bash
pnpm --filter api dev                    # Dev server (--watch --experimental-strip-types)
pnpm --filter api build                  # Build
pnpm --filter api lint                   # Lint
pnpm --filter api test                   # Run tests
pnpm --filter api test:watch             # Vitest watch mode
pnpm --filter api check-types            # Type check
pnpm --filter api db:migrate             # Run pending migrations
pnpm --filter api db:rollback            # Rollback last migration
pnpm --filter api db:create-migration X  # Scaffold migration named X
pnpm --filter api create-admin           # Create admin user via CLI
pnpm --filter api repl                   # REPL with DI container access
```

### Infrastructure

```bash
docker compose up -d    # PostgreSQL (5433:5432) + Redis (6380:6379)
```

Credentials: `saaskit/saaskit`, database: `saaskit_dev`.

## Architecture

### Monorepo Layout

- **`packages/kit/*`** -- Shared infrastructure packages (each has its own `CLAUDE.md` with detailed conventions)
  - `core` -- DI container (Awilix), Fastify server factory, graceful shutdown
  - `config` -- Zod-based config with `.env` / `.env.{ENVIRONMENT}` cascade
  - `db` -- Kysely ORM, Trx proxy (AsyncLocalStorage transactions), base/soft-delete repositories, migrations
  - `auth` -- Stateless JWT (jose), Argon2 passwords, Redis token blacklist
  - `authz` -- CASL authorization, role-based abilities, route guards
  - `schemas` -- TypeBox schemas, response envelope (`ok()`, `paginated()`), OpenAPI
  - `errors` -- Exception hierarchy, global error handler
  - `jobs` -- BullMQ auto-discovery, queue/worker management
  - `admin` -- Django-admin-style panel (htmx + Preact SSR), auto-inferred CRUD
  - `test` -- Shared test utilities (PGlite, ioredis-mock, DI container builder)
  - `eslint-config` -- Shared ESLint 10+ config
  - `ts-config` -- Shared TypeScript configs
  - `effect-ts` -- Optional Effect integration
- **`services/api`** -- Main backend application (has its own `CLAUDE.md` with module conventions)

### Key Patterns

**Dependency Injection**: Awilix with global `Dependencies` interface. Files matching `*.{repository,service,mapper,client}.{ts,js}` are auto-registered as camelCased singletons. Each module augments `Dependencies` via `declare global`.

**Vertical Slice Modules**: Each module in `services/api/src/modules/<name>/` is self-contained. No cross-module imports. See `services/api/CLAUDE.md` for the full file convention table.

**Transaction Proxy (Trx)**: Repositories depend on `Trx<DB>`, never `Kysely<DB>`. Queries auto-participate in the nearest `AsyncLocalStorage` transaction or fall through to the root pool.

**Response Envelope**: All HTTP responses use `{ data, error }` shape. Use `ok(data)` for single resources, `paginated(items, page, limit, total)` for lists.

**Config**: Zod schemas validated at startup. Base schema from `@kit/config`, extended by kit packages (db, auth, jobs) and the service's own config. Cascade: `.env` -> `.env.{ENVIRONMENT}`.

### Service Bootstrap Flow

`main.ts` -> `createConfig()` -> `createLogger()` -> `createDataSource()` -> `createTransactionStorage()` -> `createContainer()` (with providers + module globs) -> `createServer()` (with plugins + modules dirs) -> `setupGracefulShutdown()` -> `server.listen()`.

## Code Style

- **No `any`** -- use `unknown`, generics, or proper types
- **No `as` casts** -- except `as const`. Use type guards, `satisfies`, or `ts-pattern` narrowing
- **Functional style** -- factory functions returning plain objects, not classes
- **Immutability** -- `readonly`, `Readonly<>`, no mutation
- **Small functions** -- ~20 lines max, extract helpers
- **`ts-pattern`** -- prefer `match`/`P` over `if/else` chains or `switch`
- **TypeBox** -- all request/response schemas via `@sinclair/typebox`

## Tech Stack

| Layer               | Technology                                     |
| ------------------- | ---------------------------------------------- |
| Runtime             | Node.js >= 22                                  |
| Package manager     | pnpm 10.5.2                                    |
| Build orchestration | Turbo 2.9                                      |
| Framework           | Fastify 5                                      |
| ORM                 | Kysely (PostgreSQL)                            |
| DI                  | Awilix + @fastify/awilix                       |
| Config validation   | Zod 4                                          |
| Auth                | JWT (jose) + Argon2                            |
| Authorization       | CASL                                           |
| Validation/OpenAPI  | TypeBox                                        |
| Background jobs     | BullMQ (Redis)                                 |
| Testing             | Vitest (PGlite for DB, ioredis-mock for Redis) |
| Linting             | ESLint 10                                      |

## Testing

- Integration tests per route using `fastify.inject`
- Unit tests for services by swapping DI deps via `createDependenciesContainer`
- PGlite for in-memory Postgres, `ioredis-mock` for Redis
- Run a single test file: `pnpm --filter api exec vitest run path/to/file.test.ts`

## Path Aliases

`services/api` uses `#*` -> `./src/*` (Node.js subpath imports in package.json).
