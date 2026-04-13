import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

export const HiddenInput = ({ field, value }: WidgetProps): VNode => {
  const string_ = value === null || value === undefined ? '' : String(value);
  return html`<input
    type="hidden"
    id=${field.name}
    name=${field.name}
    value=${string_}
  />`;
};
