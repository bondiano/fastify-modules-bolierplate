import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { FieldSpec } from '../../types.js';

export interface WidgetProps {
  readonly field: FieldSpec;
  readonly value: unknown;
  readonly disabled?: boolean;
  readonly resourceName?: string;
}

export const TextInput = ({
  field,
  value,
  disabled = false,
}: WidgetProps): VNode => {
  const string_ = value === null || value === undefined ? '' : String(value);
  return html`<input
    type="text"
    id=${field.name}
    name=${field.name}
    value=${string_}
    placeholder=${field.placeholder ?? ''}
    maxlength=${field.maxLength ?? undefined}
    required=${field.required || undefined}
    readonly=${field.readOnly || undefined}
    disabled=${disabled || undefined}
    class="form-input"
  />`;
};
