import { Type } from '@sinclair/typebox';
import type { Static, TSchema } from '@sinclair/typebox';

import { createSuccessResponseSchema } from './response-envelope.js';
import { UuidString } from './type-helpers.js';

/**
 * Request body for bulk operations with resource IDs.
 *
 * @example
 * ```ts
 * schema: { body: bulkIdsSchema }
 * ```
 */
export const bulkIdsSchema = Type.Object({
  ids: Type.Array(UuidString(), {
    minItems: 1,
    maxItems: 100,
    description: 'Resource IDs',
  }),
});

export type BulkIds = Static<typeof bulkIdsSchema>;

/**
 * Creates a bulk update request schema with typed update fields.
 *
 * @example
 * ```ts
 * const bulkUpdatePostsSchema = createBulkUpdateSchema(
 *   Type.Object({ status: StringEnum(['draft', 'published']) }),
 * );
 * ```
 */
export const createBulkUpdateSchema = <T extends TSchema>(updateFields: T) =>
  Type.Object({
    ids: Type.Array(UuidString(), {
      minItems: 1,
      maxItems: 100,
      description: 'Resource IDs',
    }),
    data: updateFields,
  });

/**
 * Response schema for bulk delete operations.
 */
export const bulkDeleteResponseSchema = createSuccessResponseSchema(
  Type.Object({
    deletedCount: Type.Number({ description: 'Number of deleted resources' }),
  }),
);

export type BulkDeleteResponse = Static<typeof bulkDeleteResponseSchema>;

/**
 * Response schema for bulk update operations.
 */
export const bulkUpdateResponseSchema = createSuccessResponseSchema(
  Type.Object({
    updatedCount: Type.Number({ description: 'Number of updated resources' }),
  }),
);

export type BulkUpdateResponse = Static<typeof bulkUpdateResponseSchema>;
