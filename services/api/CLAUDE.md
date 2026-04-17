# services/api

Fastify backend application. Assembles `@kit/*` packages and business modules
into a running server with auth, authz, jobs, and a convention-based module
system.

## TypeScript rules

- **No `any`**. Use `unknown`, generics, or proper types. If the type system
  fights you, fix the type -- don't escape with `any`.
- **No `as` casts**. Prefer type guards, `satisfies`, or narrowing via
  `ts-pattern`/`match`. The only acceptable `as` is `as const`.
- **Prefer `ts-pattern`** (`match`/`P`) for branching on unions, discriminated
  types, or complex conditions instead of `if/else` chains or `switch`.
- **Functional style**: pure functions, immutability (`readonly`, `Readonly<>`),
  composition over mutation. Avoid classes -- use factory functions that return
  plain objects.
- **Small functions**: each function should do one thing. Extract helpers when a
  function exceeds ~20 lines.
- **No `Pick<Dependencies, ...>` in factories**. Service / repository / client
  factories must declare a standalone options interface that lists only the
  deps they consume. Never reference the global `Dependencies` (or Awilix
  `Cradle`) type inside application code. Awilix's own docs warn that doing so
  couples your code to a "god type", loses transparency, and breaks inversion
  of control (see
  https://github.com/jeffijoe/awilix#infercradlefromcontainer). The only
  place `Dependencies` may appear is the module's `<name>.module.ts` global
  augmentation -- that is how the container learns the registration type.

  ```ts
  // Bad -- couples the service to the global cradle
  export const createPostsService = ({
    postsRepository,
  }: Pick<Dependencies, 'postsRepository'>) => { ... };

  // Good -- standalone options interface, no Awilix leakage
  interface PostsServiceDeps {
    postsRepository: PostsRepository;
  }

  export const createPostsService = ({
    postsRepository,
  }: PostsServiceDeps) => { ... };
  ```

## Directory

```
src/
  main.ts                    Entry point -- bootstraps DB, DI, server
  config.ts                  App config (merges all @kit config schemas)
  db/
    schema.ts                Kysely DB interface (generated or hand-maintained)
    cli.ts                   Migration CLI (migrate, rollback, create)
  server/
    create.ts                Server factory (wraps @kit/core createServer);
                             registers kit Fastify plugins inline via the
                             `plugins` array (no wrapper files needed)
  modules/
    init.ts                  Infrastructure dependency types + Cradle augmentation
    auth/                    Auth module (register, login, refresh, logout)
    users/                   Users module (auth-related)
    posts/                   Example CRUD module (soft delete, filtering, search)
  migrations/                Kysely migration files
```

## Module convention

Each business module in `modules/<name>/` follows vertical slice architecture.
Modules are **independent** -- no direct cross-module imports. Communication
between modules goes through public interfaces or events.

| File pattern            | Purpose                                                 | Auto-loaded?              |
| ----------------------- | ------------------------------------------------------- | ------------------------- |
| `<name>.module.ts`      | Global Dependencies augmentation                        | No (types only)           |
| `<name>.repository.ts`  | DB repository (auto-registered as `<name>Repository`)   | Yes                       |
| `<name>.service.ts`     | Business logic (auto-registered as `<name>Service`)     | Yes                       |
| `<name>.mapper.ts`      | DTO mapper (auto-registered as `<name>Mapper`)          | Yes                       |
| `<name>.client.ts`      | External API client (auto-registered as `<name>Client`) | Yes                       |
| `<name>.route.ts`       | Public routes (auto-loaded by Fastify)                  | Yes                       |
| `<name>.admin.route.ts` | Admin routes (auto-loaded, prefix `/admin/`)            | Yes                       |
| `<name>.abilities.ts`   | CASL ability definer                                    | No (imported in main.ts)  |
| `schemas/*.schema.ts`   | TypeBox request/response schemas                        | No (imported in routes)   |
| `errors/*.error.ts`     | Domain-specific exceptions                              | No (imported in services) |
| `jobs/**/*.job.ts`      | BullMQ job definitions                                  | Yes (by @kit/jobs plugin) |

**Naming -> DI key:** `users.repository.ts` -> `usersRepository`,
`merchant-mids.service.ts` -> `merchantMidsService`

### Layer responsibilities

- **Routes** (`*.route.ts`): HTTP handlers. Validation, pre/post hooks,
  response formatting. No business logic.
- **Services** (`*.service.ts`): Business logic. Orchestrates repositories,
  mappers, and clients. Registered in DI container.
- **Repositories** (`*.repository.ts`): Data access (DB, cache). No business
  logic.
- **Mappers** (`*.mapper.ts`): Data transformation between layers. No side
  effects.
- **Clients** (`*.client.ts`): External API communication. May handle errors.
  No business logic.
- **Jobs** (`*.job.ts`): Background tasks via BullMQ. Call services, no
  business logic.

## How to add a new module

1. Create `modules/<name>/` directory
2. Create `<name>.repository.ts` with `createBaseRepository` or `createSoftDeleteRepository`
3. Create `<name>.service.ts` with business logic
4. Create `<name>.route.ts` with Fastify routes (export `autoPrefix`)
5. Add TypeBox schemas in `schemas/`
6. If authz needed: create `<name>.abilities.ts` and register in `main.ts`
7. Create `<name>.module.ts` with all `Dependencies` augmentations for the module

## Route patterns

```ts
const route: FastifyPluginAsyncTypebox = async (fastify) => {
  const { postsService, postsMapper } = fastify.diContainer.cradle;

  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['posts'],
      querystring: querySchema,
      response: { 200: createPaginatedEnvelopeSchema(postResponseSchema) },
    },
    handler: async (request) => {
      const result = await postsService.findFiltered(request.query);
      return paginated(
        result.items.map((item) => postsMapper.toResponse(item)),
        request.query.page,
        request.query.limit,
        result.total,
      );
    },
  });
};
export default route;
export const autoPrefix = '/posts';
```

## Response envelope

All responses use `{ data, error }`. Use `ok(data)` for single resources,
`paginated(items, page, limit, total)` for lists. Both from `@kit/schemas`.

## Schemas

Use `@sinclair/typebox` for all request/response schemas. Schemas serve as
both runtime validation and OpenAPI documentation.

## Testing

- Integration tests per route (including error cases) using `fastify.inject`
- Unit test services by swapping DI dependencies with mocks via
  `createDependenciesContainer`
- PGlite for in-memory Postgres, `ioredis-mock` for Redis
- Fixtures in `__tests__/fixtures/` -- each exports `createFixtures(dataSource)`

## Scripts

- `pnpm dev` -- Start with --watch and --experimental-strip-types
- `pnpm build` -- TypeScript compilation
- `pnpm db:migrate` -- Run pending migrations
- `pnpm db:rollback` -- Rollback last migration
- `pnpm db:create-migration <name>` -- Scaffold new migration
