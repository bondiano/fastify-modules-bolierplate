# API Development Guidelines

## Table of Contents

- [General Principles](#general-principles)
- [Project Structure](#project-structure)
- [Types and Schemas](#types-and-schemas)
- [Working with Dates](#working-with-dates)
- [Testing](#testing)
- [Error Handling](#error-handling)
- [Database](#database)

## General Principles

- Follow RESTful principles
- Use HTTP methods according to their intended purpose
- Version public APIs
- Use JSON as the data exchange format
- Use HTTP status codes to indicate request results
- Use pagination for large datasets
- Maximize code reuse

## Project Structure

We use a modular, domain-driven approach. The project is divided into domain
modules, and each module is split into layers (routes, services, repositories,
mappers).

- Each module should be grounded in domain understanding and have its own
  directory with clear layer separation
  (see [vertical slice architecture](https://www.jimmybogard.com/vertical-slice-architecture/)).
- This makes it easy to find all related entities and change logic independently
  without affecting other modules or developers
  (see [The Common Closure Principle (CCP)](https://en.wikipedia.org/wiki/Package_principles#Principles_of_package_cohesion)).
- Each module is independent (avoid direct imports across modules) and
  inter-module communication is minimal. Think of each module as a potential
  future microservice.

### Keeping modules clean and decoupled

- One module must not call another module directly (e.g., importing an entity
  from module A into module B). Create public interfaces instead (e.g., a
  function that returns data from module A for any caller, so module B can
  request it).
- For fire-and-forget logic (e.g., sending an email after an operation), use
  events for inter-module communication.
- If two modules are too "chatty", they should probably be merged into one.

### Module components

Each layer is responsible for specific functionality. Ideally each component
follows the
[Single Responsibility Principle](https://en.wikipedia.org/wiki/Single-responsibility_principle) --
a single, well-defined purpose:

- **Routes**: Standard Fastify request handlers. Attach pre/post hooks, define
  request validation, and format responses. _Must not contain business logic._
  Located in `src/modules/<feature>/*.route.ts`. Connected as
  [Fastify plugins](https://fastify.dev/docs/v4.28.x/Reference/Plugins/).
- **Jobs**: BullMQ background tasks for work that does not need to run
  synchronously (e.g., sending emails, generating reports). Located in
  `src/modules/<feature>/*.job.ts`. _Jobs must not contain business logic_ --
  they only call services.
- **Domain Services**: Where business logic lives. Describe how to create
  entities from other entities, compute derived fields, modify entities, or
  execute side effects. This layer does not work directly with raw data but
  describes business logic around it. _The domain should represent (in code)
  what the business does (in real life)._ Located in
  `src/modules/<feature>/*.service.ts`. All services are registered in the DI
  container.
- **Mappers**: Convert data from one format to another (e.g., database entity
  to domain object or vice versa). _Mappers must not have side effects._
  Located in `src/modules/<feature>/*.mapper.ts`.
- **Repositories**: Interact with external data sources (database, cache).
  Retrieve or persist data. Repositories separate business logic from
  infrastructure and make it easy to swap data sources. _Repositories must not
  contain business logic._ Located in
  `src/modules/<feature>/*.repository.ts`.
- **Clients**: Interact with external APIs (third-party services). _Must not
  contain business logic._ May handle errors. Located in
  `src/modules/<feature>/*.client.ts`.

## Types and Schemas

Use `@sinclair/typebox` for type and schema definitions. This lets us define
types and schemas in one place and use them for both request validation and
documentation.

## Working with Dates

Use ISO format since we need timezone information.

To describe a date in a schema, use the `string` type with `date-time` format.
In `@sinclair/typebox`, use `Type.Unsafe` for date schemas:

```typescript
Type.Object({
  createdAt: Type.Unsafe<Date>({
    type: 'string',
    format: 'date-time',
    example: '2020-11-24T17:43:15.970Z',
    description: 'Entity creation date',
  }),
});
```

Dates can be returned as `Date` in handlers -- they are automatically
serialized to ISO strings. However, the `Date` type is not supported by
Fastify's response mapper directly.

## Testing

- Write integration tests for every endpoint (including error cases). Use
  `fastify.inject` for this.
- For isolated service testing, swap dependencies with mocks. Use
  `createDependenciesContainer` to override dependencies.
- Use [PGlite](https://pglite.dev/) for running tests against a clean
  in-memory database (WASM-based). Use `ioredis-mock` for Redis.

### Seeding the database for tests

Migrations run before all tests. After that, seed the database with test data.

Use the fixtures approach. All fixtures are stored in `__tests__/fixtures/`.
Each use case gets its own fixture file. Each fixture module must export a
`createFixtures` function that takes `dataSource` as an argument and seeds the
database:

```typescript
// __tests__/fixtures/merchant/merchant-with-region-for-invoice.ts
const createFixtures = async (dataSource: Kysely<DB>) => {
  const { id: merchantId } = await dataSource
    .insertInto('merchants')
    .values({
      title: 'testMerchant',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const { id: merchantRegionId } = await dataSource
    .insertInto('merchantRegions')
    .values({
      merchantId,
      name: 'merchantRegionId',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return {
    merchantId,
    merchantRegionId,
  };
};
```

## Error Handling

- All business errors must be defined as separate classes with clear messages.
- All errors must extend the base errors defined in `exceptions.ts`.

## Database

- Use `kysely` and `kysely-pg` for database access.

### Relational constraints (ON DELETE CASCADE)

Avoid `ON DELETE CASCADE` in table definitions whenever possible. When needed,
use `ON DELETE SET NULL` and delete records manually.

**Reasons:**

1. **Cascades are unpredictable.** When you write `db.xxx.delete()` with
   cascade constraints, you have no idea how much data will actually be
   deleted.
2. **Garbage collection surprise.** `db.xxx.delete()` -> cascades delete
   hundreds of thousands of related rows -> database Garbage Collector kicks
   in -> all tables lock until it finishes -> downtime.
3. **Performance cost.** Constraint checks on INSERT and most UPDATE operations
   can consume 30-50% of operation time.

**What to do instead:**

- Do not use cascades
- Where related data must be deleted alongside the main entity, write explicit
  deletion code at the call site
- Create a cron job that collects and bulk-deletes orphaned records during
  low-traffic periods
- Use soft-delete
- If absolutely necessary, use `ON DELETE SET NULL`
