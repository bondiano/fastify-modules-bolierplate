/**
 * Generic paginated list view. Renders search bar, sortable column
 * headers, row template with edit/delete actions, and pagination pills,
 * all bound to the admin htmx conventions.
 */
import { html } from 'htm/preact';
import type { VNode } from 'preact';

import { safeUrl } from '../safe-url.js';
import type { AdminResourceSpec, FieldSpec } from '../types.js';

import { Icon } from './icons.js';

export interface DataTableProps {
  readonly spec: AdminResourceSpec;
  readonly rows: readonly Record<string, unknown>[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly prefix: string;
}

const MAX_CELL = 80;

const truncate = (s: string): string =>
  s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}...` : s;

/**
 * Format a value for display in a table cell. Pure, side-effect free.
 * `field` is optional for use from widgets that don't have a spec handy.
 */
export const formatCell = (value: unknown, field?: FieldSpec): string => {
  if (value === null || value === undefined) return '--';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return truncate(value.map(String).join(', '));
  if (typeof value === 'object') {
    try {
      return truncate(JSON.stringify(value));
    } catch {
      return '[object]';
    }
  }
  const string_ = String(value);
  if (field?.widget === 'datetime' || field?.widget === 'date') return string_;
  return truncate(string_);
};

const buildQs = (
  params: Readonly<Record<string, string | number | undefined>>,
): string => {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] =>
      entry[1] !== undefined && entry[1] !== null && entry[1] !== '',
  );
  if (entries.length === 0) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
};

const pickId = (row: Record<string, unknown>): string => {
  const id = row['id'];
  return id === null || id === undefined ? '' : String(id);
};

export const DataTable = ({
  spec,
  rows,
  pagination,
  query,
  prefix,
}: DataTableProps): VNode => {
  const listUrl = safeUrl(`${prefix}/${spec.name}`);
  const newUrl = safeUrl(`${prefix}/${spec.name}/new`);

  const columns = spec.list.columns;
  const fieldByName = new Map(spec.fields.map((f) => [f.name, f] as const));
  const sortable = new Set(spec.list.sortableFields);
  const currentOrderBy = query['orderBy'] ?? spec.list.defaultSort.field;
  const currentOrder =
    (query['order'] ?? spec.list.defaultSort.order) === 'asc' ? 'asc' : 'desc';
  const rowsId = `${spec.name}-rows`;

  const showActions = !spec.readOnlyResource;

  const header = html`<thead>
    <tr>
      ${columns.map((col) => {
        const f = fieldByName.get(col);
        const label = f?.label ?? col;
        if (!sortable.has(col)) return html`<th scope="col">${label}</th>`;
        const nextOrder =
          col === currentOrderBy && currentOrder === 'asc' ? 'desc' : 'asc';
        const href = safeUrl(
          `${prefix}/${spec.name}${buildQs({
            ...query,
            orderBy: col,
            order: nextOrder,
            page: '1',
          })}`,
        );
        const indicator =
          col === currentOrderBy ? (currentOrder === 'asc' ? ' ↑' : ' ↓') : '';
        return html`<th scope="col" class="sortable">
          <a
            href=${href}
            hx-get=${href}
            hx-target="#admin-main"
            hx-swap="innerHTML"
            hx-push-url="true"
          >
            ${label}${indicator}
          </a>
        </th>`;
      })}
      ${showActions
        ? html`<th scope="col" class="col-actions">Actions</th>`
        : null}
    </tr>
  </thead>`;

  const totalCols = columns.length + (showActions ? 1 : 0);

  const body = html`<tbody id=${rowsId}>
    ${rows.length === 0
      ? html`<tr class="empty">
          <td colspan=${totalCols}>No results.</td>
        </tr>`
      : rows.map((row) => {
          const id = pickId(row);
          const editHref = safeUrl(`${prefix}/${spec.name}/${id}`);
          const deleteHref = safeUrl(`${prefix}/${spec.name}/${id}`);
          return html`<tr id=${`${spec.name}-${id}`}>
            ${columns.map((col) => {
              const f = fieldByName.get(col);
              return html`<td>${formatCell(row[col], f)}</td>`;
            })}
            ${showActions
              ? html`<td class="col-actions">
                  <a
                    href=${editHref}
                    hx-get=${editHref}
                    hx-target="#admin-main"
                    hx-swap="innerHTML"
                    hx-push-url="true"
                    class="btn btn-secondary btn-sm"
                  >
                    <${Icon} name="pencil" /> Edit
                  </a>
                  <button
                    type="button"
                    class="btn btn-danger btn-sm"
                    hx-delete=${deleteHref}
                    hx-target=${`#${spec.name}-${id}`}
                    hx-swap="outerHTML"
                    hx-confirm="Delete this record?"
                  >
                    <${Icon} name="trash" /> Delete
                  </button>
                </td>`
              : null}
          </tr>`;
        })}
  </tbody>`;

  const previousPage = Math.max(1, pagination.page - 1);
  const nextPage = Math.min(pagination.totalPages || 1, pagination.page + 1);
  const previousHref = safeUrl(
    `${listUrl}${buildQs({ ...query, page: previousPage })}`,
  );
  const nextHref = safeUrl(
    `${listUrl}${buildQs({ ...query, page: nextPage })}`,
  );
  const disabledPrevious = pagination.page <= 1;
  const disabledNext = pagination.page >= pagination.totalPages;

  const filterRow =
    spec.list.filters.length === 0
      ? null
      : html`<form
          class="admin-data-table__filters"
          method="get"
          action=${listUrl}
          hx-get=${listUrl}
          hx-target="#admin-main"
          hx-swap="innerHTML"
          hx-push-url="true"
        >
          <input type="hidden" name="orderBy" value=${currentOrderBy} />
          <input type="hidden" name="order" value=${currentOrder} />
          ${spec.list.filters.map((f) => {
            const idAttribute = `filter-${f.name}`;
            if (f.kind === 'text') {
              return html`<label class="admin-filter" for=${idAttribute}>
                <span>${f.label}</span>
                <input
                  id=${idAttribute}
                  type="text"
                  name=${f.name}
                  value=${query[f.name] ?? ''}
                  class="form-input"
                />
              </label>`;
            }
            if (f.kind === 'select') {
              const opts =
                f.options === 'distinct'
                  ? [{ value: '', label: 'All' }]
                  : [{ value: '', label: 'All' }, ...f.options];
              return html`<label class="admin-filter" for=${idAttribute}>
                <span>${f.label}</span>
                <select id=${idAttribute} name=${f.name} class="form-input">
                  ${opts.map(
                    (o) =>
                      html`<option
                        value=${o.value}
                        selected=${query[f.name] === o.value || undefined}
                      >
                        ${o.label}
                      </option>`,
                  )}
                </select>
              </label>`;
            }
            // date-range
            const fromName = `${f.name}From`;
            const toName = `${f.name}To`;
            return html`<fieldset class="admin-filter admin-filter--range">
              <legend>${f.label}</legend>
              <label for=${`${idAttribute}-from`}>
                <span>From</span>
                <input
                  id=${`${idAttribute}-from`}
                  type="date"
                  name=${fromName}
                  value=${query[fromName] ?? ''}
                  class="form-input"
                />
              </label>
              <label for=${`${idAttribute}-to`}>
                <span>To</span>
                <input
                  id=${`${idAttribute}-to`}
                  type="date"
                  name=${toName}
                  value=${query[toName] ?? ''}
                  class="form-input"
                />
              </label>
            </fieldset>`;
          })}
          <button type="submit" class="btn btn-primary btn-sm">Apply</button>
          <a href=${listUrl} class="btn btn-secondary btn-sm">Clear</a>
        </form>`;

  return html`<section class="admin-data-table" data-resource=${spec.name}>
    <header class="admin-data-table__header">
      <h1>${spec.label}</h1>
      ${showActions
        ? html`<a
            href=${newUrl}
            hx-get=${newUrl}
            hx-target="#admin-main"
            hx-swap="innerHTML"
            hx-push-url="true"
            class="btn btn-primary"
          >
            <${Icon} name="plus" /> New
          </a>`
        : null}
    </header>
    ${filterRow}
    <form
      class="admin-data-table__search"
      onsubmit="return false"
      role="search"
    >
      <input
        type="search"
        name="search"
        value=${query['search'] ?? ''}
        placeholder="Search..."
        hx-get=${listUrl}
        hx-trigger="keyup changed delay:300ms"
        hx-target=${`#${rowsId}`}
        hx-swap="innerHTML"
        hx-include="[name='orderBy'],[name='order']"
        class="form-input"
      />
      <input type="hidden" name="orderBy" value=${currentOrderBy} />
      <input type="hidden" name="order" value=${currentOrder} />
    </form>
    <table class="admin-table">
      ${header}${body}
    </table>
    <nav class="admin-pagination" aria-label="Pagination">
      <a
        class=${`btn btn-secondary btn-sm ${disabledPrevious ? 'disabled' : ''}`}
        href=${previousHref}
        hx-get=${previousHref}
        hx-target="#admin-main"
        hx-swap="innerHTML"
        hx-push-url="true"
        aria-disabled=${disabledPrevious ? 'true' : 'false'}
      >
        Prev
      </a>
      <span class="admin-pagination__info">
        Page ${pagination.page} of ${pagination.totalPages || 1} ·
        ${pagination.total} total
      </span>
      <a
        class=${`btn btn-secondary btn-sm ${disabledNext ? 'disabled' : ''}`}
        href=${nextHref}
        hx-get=${nextHref}
        hx-target="#admin-main"
        hx-swap="innerHTML"
        hx-push-url="true"
        aria-disabled=${disabledNext ? 'true' : 'false'}
      >
        Next
      </a>
    </nav>
  </section>`;
};
