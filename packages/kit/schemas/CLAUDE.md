# @kit/schemas

Shared TypeBox schemas and type helpers for request/response validation and
OpenAPI documentation across the Fastify SaaS Kit.

## Directory

```
src/
  type-helpers.ts        StringEnum, DateTimeString, UuidString, EmailString
  params.ts              idParameterSchema (path parameter)
  pagination.ts          paginatedQuerySchema, createOrderByQuerySchema,
                         paginationSchema, createListResponseSchema,
                         createPaginatedResponseSchema, calculatePagination
  response-envelope.ts   apiErrorSchema, createSuccessResponseSchema,
                         apiErrorEnvelopeSchema, createResponseSchema,
                         createPaginatedEnvelopeSchema, createListEnvelopeSchema,
                         ok(), paginated() helpers
  timestamps.ts          idSchema, timestampsSchema, softDeleteTimestampSchema,
                         baseEntitySchema, softDeletableEntitySchema
  filters.ts             searchQuerySchema, createFilterQuerySchema
  bulk.ts                bulkIdsSchema, createBulkUpdateSchema,
                         bulkDeleteResponseSchema, bulkUpdateResponseSchema
  error-response.ts      apiErrorResponseSchema (deprecated, use apiErrorEnvelopeSchema)
  index.ts               Re-exports everything
```

## Response Envelope

All API responses use `{ data, error }` envelope. Both fields are always
present (one is `null`).

```ts
import {
  createSuccessResponseSchema,
  apiErrorEnvelopeSchema,
  ok,
  paginated,
} from '@kit/schemas';

// Route schema:
schema: {
  response: {
    200: createSuccessResponseSchema(userSchema),
    404: apiErrorEnvelopeSchema,
  },
}

// Handler (single resource):
return ok(user);

// Handler (paginated list):
const { items, total } = await usersService.findPaginated({ page, limit });
return paginated(items, page, limit, total);
```

## Pagination + Filtering + Search in a route

```ts
import {
  paginatedQuerySchema,
  createOrderByQuerySchema,
  searchQuerySchema,
  createFilterQuerySchema,
  createPaginatedEnvelopeSchema,
  paginated,
  StringEnum,
} from '@kit/schemas';
import { Type } from '@sinclair/typebox';

const sortSchema = createOrderByQuerySchema(['createdAt', 'name']);
const postFilters = createFilterQuerySchema({
  status: StringEnum(['draft', 'published']),
  authorId: Type.String(),
});
const querySchema = Type.Composite([
  paginatedQuerySchema, sortSchema, searchQuerySchema, postFilters,
]);

// In route definition:
schema: {
  querystring: querySchema,
  response: { 200: createPaginatedEnvelopeSchema(postResponseSchema) },
}

// In handler:
const { page, limit, orderBy, order, search, status, authorId } = request.query;
const { items, total } = await postsService.findPaginated({
  page, limit, orderBy, order, search, status, authorId,
});
return paginated(items, page, limit, total);
```

## Entity schemas for responses

```ts
import {
  baseEntitySchema,
  softDeletableEntitySchema,
  EmailString,
  StringEnum,
} from '@kit/schemas';
import { Type } from '@sinclair/typebox';

// Standard entity:
const userResponseSchema = Type.Composite([
  baseEntitySchema,
  Type.Object({ email: EmailString(), role: StringEnum(['admin', 'user']) }),
]);

// Soft-deletable entity (includes deletedAt):
const postResponseSchema = Type.Composite([
  softDeletableEntitySchema,
  Type.Object({
    title: Type.String(),
    status: StringEnum(['draft', 'published']),
  }),
]);
```

## Bulk operations

```ts
import { bulkIdsSchema, bulkDeleteResponseSchema, createBulkUpdateSchema } from '@kit/schemas';

// Bulk delete route:
schema: { body: bulkIdsSchema, response: { 200: bulkDeleteResponseSchema } }

// Bulk update with typed fields:
const bulkUpdateSchema = createBulkUpdateSchema(
  Type.Object({ status: StringEnum(['draft', 'published']) }),
);
```

## Conventions

- All schemas are TypeBox objects -- they produce JSON Schema for Fastify
  validation and OpenAPI generation simultaneously.
- Use `StringEnum` instead of `Type.Enum` for string unions -- it produces
  cleaner OpenAPI output.
- Use `createPaginatedEnvelopeSchema` for paginated list endpoints,
  `createListEnvelopeSchema` for non-paginated lists. These wrap the inner
  data in the `{ data, error }` envelope.
- Use `ok()` and `paginated()` helpers in route handlers to produce the envelope.
- Module-specific schemas live in `modules/<name>/schemas/`, not here.
  This package is for schemas reused across multiple modules.
- `apiErrorResponseSchema` is deprecated. Use `apiErrorEnvelopeSchema` for
  route error response definitions.
