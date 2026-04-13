import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

const toLocalDateTime = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  // YYYY-MM-DDTHH:mm in UTC. `datetime-local` is naive; we feed UTC slice.
  return d.toISOString().slice(0, 16);
};

export const DateTimeInput = ({
  field,
  value,
  disabled = false,
}: WidgetProps): VNode => {
  return html`<input
    type="datetime-local"
    id=${field.name}
    name=${field.name}
    value=${toLocalDateTime(value)}
    required=${field.required || undefined}
    readonly=${field.readOnly || undefined}
    disabled=${disabled || undefined}
    class="form-input"
  />`;
};
