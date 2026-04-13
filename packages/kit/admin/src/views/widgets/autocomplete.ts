import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

/**
 * FK autocomplete. Relies on the server route
 * `GET /admin/:resource/_relations/:col?q=...` returning an HTML list of
 * `<li data-value="id">Label</li>` entries that htmx swaps into the
 * results div. Selecting a row is handled by a tiny inline handler.
 */
export const AutocompleteInput = ({
  field,
  value,
  disabled = false,
  resourceName,
}: WidgetProps): VNode => {
  const current = value === null || value === undefined ? '' : String(value);
  const endpoint = resourceName
    ? `/admin/${resourceName}/_relations/${field.name}`
    : '';
  return html`<div class="form-autocomplete" data-field=${field.name}>
    <input type="hidden" id=${field.name} name=${field.name} value=${current} />
    <input
      type="text"
      name=${`${field.name}__display`}
      value=${current}
      placeholder=${field.placeholder ?? 'Search...'}
      required=${field.required || undefined}
      readonly=${field.readOnly || undefined}
      disabled=${disabled || undefined}
      class="form-input"
      hx-get=${endpoint}
      hx-trigger="keyup changed delay:300ms"
      hx-target=${`#${field.name}__results`}
      hx-swap="innerHTML"
      hx-push-url="false"
    />
    <div
      id=${`${field.name}__results`}
      class="form-autocomplete__results"
      role="listbox"
    ></div>
  </div>`;
};
