/**
 * Map a `ColumnMeta` to a default `WidgetKind`. Pure function, no IO.
 * Per PRD §15.3.J. Overrides applied later via `mergeOverrides`.
 */
import type { ColumnMeta, WidgetKind } from '../types.js';

const NUMERIC_TYPES = new Set<ColumnMeta['type']>([
  'int2',
  'int4',
  'int8',
  'numeric',
  'float4',
  'float8',
]);

const STRING_TYPES = new Set<ColumnMeta['type']>(['text', 'varchar', 'char']);

export const inferWidget = (column: ColumnMeta): WidgetKind => {
  // Generated PKs render as read-only (hidden-on-create handled by caller).
  if (column.isPrimaryKey && column.generated) return 'readonly';

  // Foreign keys always become autocomplete (falls back to async lookup).
  if (column.references !== null) return 'autocomplete';

  // Enums become radio-groups for tiny sets, selects otherwise.
  if (column.type === 'enum') {
    if (column.enumValues !== null && column.enumValues.length <= 4)
      return 'radio-group';
    return 'select';
  }

  if (column.type === 'bool') return 'checkbox';
  if (NUMERIC_TYPES.has(column.type)) return 'number';
  if (column.type === 'date') return 'date';
  if (column.type === 'timestamp' || column.type === 'timestamptz')
    return 'datetime';
  if (column.type === 'time') return 'datetime';
  if (column.type === 'json' || column.type === 'jsonb') return 'json';
  if (column.type === 'text_array') return 'tags';

  if (STRING_TYPES.has(column.type)) {
    if (column.maxLength === null || column.maxLength > 200) return 'textarea';
    return 'text';
  }

  if (column.type === 'uuid') return 'text';

  return 'text';
};
