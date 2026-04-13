import { Type } from '@sinclair/typebox';
import type { SchemaOptions, TLiteral, TUnion } from '@sinclair/typebox';

/**
 * Creates a TypeBox schema for a string enum using a union of literals.
 *
 * @example
 * ```ts
 * const StatusSchema = StringEnum(['active', 'inactive', 'pending']);
 * ```
 */
export const StringEnum = <T extends string[]>(
  values: [...T],
  options?: SchemaOptions,
): TUnion<{ [K in keyof T]: TLiteral<T[K] & string> }> =>
  Type.Union(
    values.map((v) => Type.Literal(v)),
    options,
  ) as TUnion<{ [K in keyof T]: TLiteral<T[K] & string> }>;

/**
 * TypeBox schema for a date-time string (ISO 8601).
 */
export const DateTimeString = (options?: SchemaOptions) =>
  Type.String({ format: 'date-time', ...options });

/**
 * TypeBox schema for a UUID string.
 */
export const UuidString = (options?: SchemaOptions) =>
  Type.String({ format: 'uuid', ...options });

/**
 * TypeBox schema for an email string.
 */
export const EmailString = (options?: SchemaOptions) =>
  Type.String({ format: 'email', ...options });
