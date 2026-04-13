import { describe, expect, it } from 'vitest';

import { renderFragment } from '../render.js';

import { DataTable, formatCell } from './data-table.js';
import { makeFieldSpec, makeResourceSpec } from './fixtures.js';

describe('formatCell', () => {
  it('returns an em-dash for null/undefined', () => {
    expect(formatCell(null)).toBe('--');
    expect(formatCell()).toBe('--');
  });

  it('formats booleans as check/cross', () => {
    expect(formatCell(true)).toBe('✓');
    expect(formatCell(false)).toBe('✗');
  });

  it('joins arrays and stringifies objects', () => {
    expect(formatCell(['a', 'b'])).toBe('a, b');
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });

  it('truncates long strings', () => {
    const big = 'x'.repeat(200);
    const out = formatCell(big);
    expect(out.endsWith('...')).toBe(true);
    expect(out.length).toBeLessThan(big.length);
  });
});

describe('DataTable', () => {
  const spec = makeResourceSpec({
    fields: [
      makeFieldSpec({
        name: 'id',
        label: 'ID',
        widget: 'readonly',
        readOnly: true,
      }),
      makeFieldSpec({ name: 'title', label: 'Title', required: true }),
    ],
  });

  const rows = [
    { id: '1', title: 'First' },
    { id: '2', title: 'Second' },
  ];

  const pagination = { page: 1, limit: 20, total: 2, totalPages: 1 };
  const out = renderFragment(
    DataTable({ spec, rows, pagination, query: {}, prefix: '/admin' }),
  );

  it('renders a sortable header', () => {
    expect(out).toContain('<th scope="col" class="sortable">');
    expect(out).toContain('Title');
  });

  it('renders a row per item with a stable id', () => {
    expect(out).toContain('id="posts-1"');
    expect(out).toContain('id="posts-2"');
    expect(out).toContain('First');
    expect(out).toContain('Second');
  });

  it('renders a delete button with hx-delete', () => {
    expect(out).toContain('hx-delete="/admin/posts/1"');
    expect(out).toContain('hx-confirm="Delete this record?"');
  });

  it('renders the New button linking to /new', () => {
    expect(out).toContain('/admin/posts/new');
  });

  it('renders the search input bound to htmx', () => {
    expect(out).toContain('name="search"');
    expect(out).toContain('hx-trigger="keyup changed delay:300ms"');
  });

  it('shows an empty state when rows are empty', () => {
    const empty = renderFragment(
      DataTable({
        spec,
        rows: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        query: {},
        prefix: '/admin',
      }),
    );
    expect(empty).toContain('No results.');
  });
});
