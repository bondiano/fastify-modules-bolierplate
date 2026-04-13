import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

export const RadioGroup = ({
  field,
  value,
  disabled = false,
}: WidgetProps): VNode => {
  const current = value === null || value === undefined ? '' : String(value);
  const options = field.enumValues ?? [];
  return html`<div
    class="form-radio-group"
    role="radiogroup"
    aria-labelledby=${field.name}
  >
    ${options.map(
      (opt) =>
        html`<label class="form-radio">
          <input
            type="radio"
            name=${field.name}
            value=${opt}
            checked=${opt === current || undefined}
            required=${field.required || undefined}
            disabled=${disabled || field.readOnly || undefined}
          />
          <span>${opt}</span>
        </label>`,
    )}
  </div>`;
};
