import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

const joinTags = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
};

export const TagsInput = ({
  field,
  value,
  disabled = false,
}: WidgetProps): VNode => {
  return html`<input
    type="text"
    id=${field.name}
    name=${field.name}
    value=${joinTags(value)}
    placeholder=${field.placeholder ?? 'comma, separated, tags'}
    required=${field.required || undefined}
    readonly=${field.readOnly || undefined}
    disabled=${disabled || undefined}
    class="form-input"
    data-hint="tags"
  />`;
};
