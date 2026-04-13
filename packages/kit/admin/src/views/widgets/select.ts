import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

export const SelectInput = ({
  field,
  value,
  disabled = false,
}: WidgetProps): VNode => {
  const current = value === null || value === undefined ? '' : String(value);
  const options = field.enumValues ?? [];
  const blank = field.required
    ? null
    : html`<option value="" selected=${current === '' || undefined}></option>`;
  return html`<select
    id=${field.name}
    name=${field.name}
    required=${field.required || undefined}
    disabled=${disabled || field.readOnly || undefined}
    class="form-input"
  >
    ${blank}
    ${options.map(
      (opt) =>
        html`<option value=${opt} selected=${opt === current || undefined}>
          ${opt}
        </option>`,
    )}
  </select>`;
};
