/**
 * Read-only widget for `Record<string, { before, after }>` payloads
 * (`audit_log.diff`). Renders a side-by-side per-field diff: column on
 * the left is the previous value, column on the right is the new value.
 * Pure SSR -- no JS, no inline styles. CSS lives in `assets/admin.css`
 * under `.admin-json-diff*`.
 */
import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { WidgetProps } from './text.js';

const formatScalar = (value: unknown): string => {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'string') return value === '' ? '""' : value;
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[object]';
  }
};

const isDiffEntry = (v: unknown): v is { before: unknown; after: unknown } =>
  typeof v === 'object' && v !== null && 'before' in v && 'after' in v;

export const JsonDiffInput = ({ value }: WidgetProps): VNode => {
  if (value === null || value === undefined) {
    return html`<p class="admin-json-diff__empty">No diff recorded.</p>`;
  }

  const entries: Array<[string, { before: unknown; after: unknown }]> = [];

  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const [field, raw] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (isDiffEntry(raw)) entries.push([field, raw]);
    }
  }

  if (entries.length === 0) {
    return html`<pre class="admin-json-diff__raw">
${JSON.stringify(value, null, 2)}</pre
    >`;
  }

  return html`<table class="admin-json-diff">
    <thead>
      <tr>
        <th scope="col">Field</th>
        <th scope="col" class="admin-json-diff__before">Before</th>
        <th scope="col" class="admin-json-diff__after">After</th>
      </tr>
    </thead>
    <tbody>
      ${entries.map(
        ([field, { before, after }]) =>
          html`<tr>
            <th scope="row">${field}</th>
            <td class="admin-json-diff__before">${formatScalar(before)}</td>
            <td class="admin-json-diff__after">${formatScalar(after)}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
};
