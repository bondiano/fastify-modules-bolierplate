import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

export const NumberInput = ({
  field,
  value,
  disabled = false,
}: WidgetProps): VNode => {
  const string_ =
    value === null || value === undefined || typeof value === 'boolean'
      ? ''
      : String(value);
  return html`<input
    type="number"
    id=${field.name}
    name=${field.name}
    value=${string_}
    placeholder=${field.placeholder ?? ''}
    required=${field.required || undefined}
    readonly=${field.readOnly || undefined}
    disabled=${disabled || undefined}
    class="form-input"
  />`;
};
