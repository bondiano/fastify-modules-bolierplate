import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import { DateTimeString, UuidString } from './type-helpers.js';

/**
 * Timestamp fields for entity responses.
 * Compose into response schemas via `Type.Composite([baseEntitySchema, ...])`.
 */
export const timestampsSchema = Type.Object({
  createdAt: DateTimeString({ description: 'Creation timestamp' }),
  updatedAt: DateTimeString({ description: 'Last update timestamp' }),
});

export type Timestamps = Static<typeof timestampsSchema>;

/**
 * Soft-delete timestamp for entities that support soft deletion.
 */
export const softDeleteTimestampSchema = Type.Object({
  deletedAt: Type.Union([DateTimeString(), Type.Null()], {
    description: 'Soft-delete timestamp, null if not deleted',
  }),
});

export type SoftDeleteTimestamp = Static<typeof softDeleteTimestampSchema>;

/**
 * Resource ID schema for response objects.
 */
export const idSchema = Type.Object({
  id: UuidString({ description: 'Resource ID' }),
});

export type Id = Static<typeof idSchema>;

/**
 * Base entity: id + timestamps. Compose with domain fields.
 *
 * @example
 * ```ts
 * const userResponseSchema = Type.Composite([
 *   baseEntitySchema,
 *   Type.Object({ email: EmailString(), role: StringEnum(['admin', 'user']) }),
 * ]);
 * ```
 */
export const baseEntitySchema = Type.Composite([idSchema, timestampsSchema]);

export type BaseEntity = Static<typeof baseEntitySchema>;

/**
 * Soft-deletable entity: id + timestamps + deletedAt.
 */
export const softDeletableEntitySchema = Type.Composite([
  baseEntitySchema,
  softDeleteTimestampSchema,
]);

export type SoftDeletableEntity = Static<typeof softDeletableEntitySchema>;
