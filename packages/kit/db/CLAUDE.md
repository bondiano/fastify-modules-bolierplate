# @kit/db

Database layer for the Fastify SaaS Kit. Wraps Kysely (PostgreSQL) with a
transaction proxy, a generic base repository, a migrator helper, and config
schema fragments.

## Directory

```
src/
  runtime/                    Runtime (app-level) database utilities
    data-source.ts            createDataSource / closeDataSource (Kysely + pg Pool + CamelCase)
    transaction.ts            Trx<DB> proxy + AsyncLocalStorage-backed factory
    repository.ts             createBaseRepository<DB, Table> (findById/create/update/...)
                              + PageBasedPaginationOptions, PaginatedPage
    soft-delete-repository.ts createSoftDeleteRepository<DB, Table> (soft delete support)
    bulk-operations.ts        createBulkOperations, createSoftDeleteBulkOperations
    search.ts                 applySearch (ILIKE helper for search across columns)
    errors.ts                 PostgresErrorCodes + isUniqueViolation / isForeignKeyViolation
    config.ts                 dbConfigSchema fragment (DATABASE_URL, max connections, log flag)
  cli/                        CLI-only utilities (migrations, scaffolding)
    migrator.ts               createMigrator + migrateToLatest / rollbackLast / createMigrationFile
```

## Key ideas

- **Trx proxy.** `createTransactionFactory` returns a callable proxy that is
  _both_ a function (start a transaction) and a Kysely query builder
  (transparently routed to the ambient transaction via AsyncLocalStorage, or
  the root pool if none is active). Repositories depend on `Trx<DB>`, never on
  `Kysely<DB>` directly, so every call site automatically participates in the
  nearest outer transaction.
- **Single AsyncLocalStorage instance.** `createTransactionStorage` is the
  only place that imports `node:async_hooks`. Importing it elsewhere during
  tests breaks transaction propagation because vitest isolates modules.
- **Generic base repo.** `createBaseRepository<DB, Table>(trx, 'users')`
  returns CRUD helpers assuming an `id` column. Tables with composite keys
  should build bespoke repositories instead of extending this.
- **Soft delete repo.** `createSoftDeleteRepository<DB, Table>(trx, 'posts')`
  extends the base with `deletedAt` filtering. All reads exclude soft-deleted
  rows; `deleteById` sets `deletedAt`; use `hardDeleteById` for permanent removal.
- **Bulk operations.** `createBulkOperations` and `createSoftDeleteBulkOperations`
  provide `bulkDelete` and `bulkUpdate` for admin panel use.
- **No DI coupling.** This package does not register anything in Awilix; the
  consuming service wires `dataSource`, `transactionStorage`, and
  `transaction` into its own container and augments `Dependencies`.

## Wiring sketch (in services/api)

Use `dbProvider()` to register the `transaction` factory. `dataSource` and
`transactionStorage` are infra values, so pass them through `extraValues`.

```ts
// main.ts
import {
  createDataSource,
  createTransactionStorage,
  dbProvider,
  type Trx,
} from '@kit/db/runtime';
import { createContainer } from '@kit/core/di';
import type { Kysely } from 'kysely';
import type { DB } from '#db/schema.ts'; // generated types

declare global {
  interface Dependencies {
    dataSource: Kysely<DB>;
    transactionStorage: Awaited<
      ReturnType<typeof createTransactionStorage<DB>>
    >;
    transaction: Trx<DB>;
  }
}

const dataSource = createDataSource<DB>({
  logger,
  connectionString: config.DATABASE_URL,
});
const transactionStorage = await createTransactionStorage<DB>();

const container = await createContainer({
  logger,
  config,
  extraValues: { dataSource, transactionStorage },
  providers: [dbProvider() /* ...other providers */],
});
```

## Adding a repository

```ts
// modules/users/users.repository.ts -- standard (hard delete)
import { createBaseRepository, isUniqueViolation } from '@kit/db';
import type { DB } from '#db/schema.ts';

export const createUsersRepository = ({
  transaction,
}: Pick<Dependencies, 'transaction'>) => {
  const base = createBaseRepository<DB, 'users'>(transaction, 'users');
  return {
    ...base,
    findByEmail: (email: string) =>
      transaction
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst(),
  };
};

declare global {
  interface Dependencies {
    usersRepository: ReturnType<typeof createUsersRepository>;
  }
}
```

## Adding a soft-delete repository

```ts
// modules/posts/posts.repository.ts -- soft delete
import {
  createSoftDeleteRepository,
  createSoftDeleteBulkOperations,
  applySearch,
} from '@kit/db';
import type { DB } from '#db/schema.ts';

export const createPostsRepository = ({
  transaction,
}: Pick<Dependencies, 'transaction'>) => {
  const base = createSoftDeleteRepository<DB, 'posts'>(transaction, 'posts');
  const bulk = createSoftDeleteBulkOperations<DB, 'posts'>(
    transaction,
    'posts',
  );
  return {
    ...base,
    ...bulk,
    findFiltered: async ({ search, status, page = 1, limit = 20 }) => {
      let query = transaction
        .selectFrom('posts')
        .selectAll()
        .where('deletedAt', 'is', null);
      if (search)
        query = applySearch(query, transaction, search, ['title', 'content']);
      if (status) query = query.where('status', '=', status);
      // ... add pagination, return { items, total }
    },
  };
};
```

## Page-based pagination

`findPaginatedByPage` returns `{ items, total }` aligned with `@kit/schemas`:

```ts
// In service:
const { items, total } = await postsRepository.findPaginatedByPage({
  page,
  limit,
  orderByField: orderBy,
  orderByDirection: order,
});
// In route handler:
return paginated(items, page, limit, total);
```

## Search helper

`applySearch(query, trx, searchTerm, columns)` adds `OR col ILIKE %term%`
for each column. For PostgreSQL full-text search (tsvector/tsquery), write
custom queries in the module's repository.

## Migrations

```ts
import {
  migrateToLatest,
  rollbackLast,
  createMigrationFile,
} from '@kit/db/migrator';
```

Expose these as `pnpm db:migrate`, `pnpm db:rollback`, `pnpm db:create-migration <name>`
from the service-level package.json. Types are generated separately via
`kysely-codegen` (not shipped in this package).

## Error translation

`@kit/db` does **not** throw HTTP-shaped exceptions. Catch
`isUniqueViolation` / `isForeignKeyViolation` at the service layer and map
to the appropriate `@kit/errors` exception there -- this keeps the data
layer framework-agnostic.
