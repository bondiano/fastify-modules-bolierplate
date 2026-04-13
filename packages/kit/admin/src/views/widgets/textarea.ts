import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

export const Textarea = ({
  field,
  value,
  disabled = false,
}: WidgetProps): VNode => {
  const string_ = value === null || value === undefined ? '' : String(value);
  return html`<textarea
    id=${field.name}
    name=${field.name}
    rows="6"
    placeholder=${field.placeholder ?? ''}
    maxlength=${field.maxLength ?? undefined}
    required=${field.required || undefined}
    readonly=${field.readOnly || undefined}
    disabled=${disabled || undefined}
    class="form-input"
  >
${string_}</textarea
  >`;
};
