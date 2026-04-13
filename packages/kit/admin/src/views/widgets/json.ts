import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

const stringifyJson = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
};

export const JsonInput = ({
  field,
  value,
  disabled = false,
}: WidgetProps): VNode => {
  return html`<textarea
    id=${field.name}
    name=${field.name}
    rows="8"
    placeholder="{}"
    data-hint="json"
    required=${field.required || undefined}
    readonly=${field.readOnly || undefined}
    disabled=${disabled || undefined}
    class="form-input form-input--mono"
  >
${stringifyJson(value)}</textarea
  >`;
};
