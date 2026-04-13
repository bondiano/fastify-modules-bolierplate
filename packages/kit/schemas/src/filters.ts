import { Type } from '@sinclair/typebox';
import type { Static, TObject, TProperties, TSchema } from '@sinclair/typebox';

/**
 * Search query parameter for full-text search on list endpoints.
 *
 * @example
 * ```ts
 * const querySchema = Type.Composite([
 *   paginatedQuerySchema, sortSchema, searchQuerySchema, moduleFilters,
 * ]);
 * ```
 */
export const searchQuerySchema = Type.Object({
  search: Type.Optional(
    Type.String({
      description: 'Full-text search query',
      minLength: 1,
    }),
  ),
});

export type SearchQuery = Static<typeof searchQuerySchema>;

/**
 * Creates a filter query schema from field definitions.
 * Each field is automatically wrapped in `Type.Optional`.
 *
 * @example
 * ```ts
 * const postFilters = createFilterQuerySchema({
 *   status: StringEnum(['draft', 'published']),
 *   authorId: Type.String(),
 * });
 *
 * const querySchema = Type.Composite([
 *   paginatedQuerySchema, sortSchema, searchQuerySchema, postFilters,
 * ]);
 * ```
 */
export const createFilterQuerySchema = <T extends TProperties>(
  filters: T,
): TObject => {
  const optionalFilters: Record<string, TSchema> = {};
  for (const [key, schema] of Object.entries(filters)) {
    optionalFilters[key] = Type.Optional(schema);
  }
  return Type.Object(optionalFilters);
};
