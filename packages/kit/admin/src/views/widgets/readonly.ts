import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

export const ReadonlyField = ({ field, value }: WidgetProps): VNode => {
  const display =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return html`<span class="form-readonly">
    <span class="form-readonly__value">${display === '' ? '--' : display}</span>
    <input type="hidden" id=${field.name} name=${field.name} value=${display} />
  </span>`;
};
