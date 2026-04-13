import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

export const CheckboxInput = ({
  field,
  value,
  disabled = false,
}: WidgetProps): VNode => {
  const checked = Boolean(value);
  return html`<span class="form-checkbox-wrap">
    <input type="hidden" name=${field.name} value="false" />
    <input
      type="checkbox"
      id=${field.name}
      name=${field.name}
      value="true"
      checked=${checked || undefined}
      disabled=${disabled || field.readOnly || undefined}
      class="form-checkbox"
    />
  </span>`;
};
