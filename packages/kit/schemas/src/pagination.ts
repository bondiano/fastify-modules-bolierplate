import { Type } from '@sinclair/typebox';
import type { SchemaOptions, Static, TSchema } from '@sinclair/typebox';

import { StringEnum } from './type-helpers.js';

/**
 * Standard paginated query parameters schema.
 * Uses page/limit (1-indexed pages) for simplicity.
 *
 * @example
 * ```ts
 * schema: { querystring: paginatedQuerySchema }
 * ```
 */
export const paginatedQuerySchema = Type.Object({
  page: Type.Integer({
    description: 'Page number (1-indexed)',
    minimum: 1,
    maximum: 99_999,
    default: 1,
  }),
  limit: Type.Integer({
    description: 'Number of items per page',
    minimum: 1,
    maximum: 100,
    default: 20,
  }),
});

export type PaginatedQuery = Static<typeof paginatedQuerySchema>;

/**
 * Creates an order-by query schema with the specified sortable fields.
 *
 * @example
 * ```ts
 * const sortSchema = createOrderByQuerySchema(['createdAt', 'name', 'email']);
 * // Use with Type.Composite to merge with paginatedQuerySchema
 * schema: { querystring: Type.Composite([paginatedQuerySchema, sortSchema]) }
 * ```
 */
export const createOrderByQuerySchema = <T extends string[]>(
  values: [...T],
  options?: Pick<SchemaOptions, 'default'>,
) =>
  Type.Object({
    orderBy: Type.Optional(
      StringEnum(values, {
        description: 'Field to order by',
        ...options,
      }),
    ),
    order: Type.Optional(
      StringEnum(['asc', 'desc'], {
        description: 'Order direction',
        default: 'desc',
      }),
    ),
  });

/**
 * Pagination metadata schema for responses.
 */
export const paginationSchema = Type.Object({
  page: Type.Number({ description: 'Current page number' }),
  limit: Type.Number({ description: 'Items per page' }),
  total: Type.Number({ description: 'Total number of items' }),
  totalPages: Type.Number({ description: 'Total number of pages' }),
});

export type Pagination = Static<typeof paginationSchema>;

/**
 * Creates a list response schema (items array, no pagination metadata).
 */
export const createListResponseSchema = <T extends TSchema>(item: T) =>
  Type.Object({
    items: Type.Array(item),
  });

/**
 * Creates a paginated response schema with items and pagination metadata.
 */
export const createPaginatedResponseSchema = <T extends TSchema>(item: T) =>
  Type.Object({
    items: Type.Array(item),
    pagination: paginationSchema,
  });

/**
 * Calculate pagination metadata from query params and total count.
 */
export const calculatePagination = (
  page: number,
  limit: number,
  total: number,
): Pagination => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
