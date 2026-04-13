import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

/**
 * Standard path parameter schema for resource ID.
 *
 * @example
 * ```ts
 * // In a route definition:
 * schema: { params: idParameterSchema }
 * ```
 */
export const idParameterSchema = Type.Object({
  id: Type.String({ description: 'Resource ID' }),
});

export type IdParameter = Static<typeof idParameterSchema>;
