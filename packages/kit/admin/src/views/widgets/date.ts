import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

const toDateString = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
};

export const DateInput = ({
  field,
  value,
  disabled = false,
}: WidgetProps): VNode => {
  return html`<input
    type="date"
    id=${field.name}
    name=${field.name}
    value=${toDateString(value)}
    required=${field.required || undefined}
    readonly=${field.readOnly || undefined}
    disabled=${disabled || undefined}
    class="form-input"
  />`;
};
