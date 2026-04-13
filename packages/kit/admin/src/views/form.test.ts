import { describe, expect, it } from 'vitest';

import { renderFragment } from '../render.js';

import { makeFieldSpec, makeResourceSpec } from './fixtures.js';
import { Form } from './form.js';

const baseSpec = makeResourceSpec({
  fields: [
    makeFieldSpec({
      name: 'id',
      label: 'ID',
      widget: 'readonly',
      readOnly: true,
    }),
    makeFieldSpec({
      name: 'title',
      label: 'Title',
      required: true,
      maxLength: 120,
    }),
    makeFieldSpec({ name: 'body', label: 'Body', widget: 'textarea' }),
  ],
});

describe('Form in create mode', () => {
  const out = renderFragment(
    Form({
      spec: baseSpec,
      mode: 'create',
      values: {},
      errors: {},
      prefix: '/admin',
      csrfToken: 'csrf-xyz',
      action: '/admin/posts',
      method: 'POST',
    }),
  );

  it('includes a hidden csrf input', () => {
    expect(out).toContain('name="_csrf"');
    expect(out).toContain('value="csrf-xyz"');
  });

  it('binds the form to hx-post on the given action', () => {
    expect(out).toContain('hx-post="/admin/posts"');
  });

  it('skips the readonly id field on create', () => {
    expect(out).not.toContain('id="id"');
  });

  it('renders the title input with maxlength and required', () => {
    expect(out).toContain('name="title"');
    expect(out).toContain('maxlength="120"');
    expect(out).toContain('required');
  });

  it('renders a textarea for body', () => {
    expect(out).toContain('<textarea');
    expect(out).toContain('name="body"');
  });
});

describe('Form in update mode', () => {
  const out = renderFragment(
    Form({
      spec: baseSpec,
      mode: 'update',
      values: { id: '42', title: 'Hello', body: 'World' },
      errors: { title: 'Too short' },
      prefix: '/admin',
      csrfToken: 'csrf-xyz',
      action: '/admin/posts/42',
      method: 'PATCH',
    }),
  );

  it('uses hx-patch instead of hx-post', () => {
    expect(out).toContain('hx-patch="/admin/posts/42"');
    expect(out).not.toContain('hx-post="/admin/posts/42"');
  });

  it('renders the readonly id as plain text', () => {
    expect(out).toContain('form-readonly');
    expect(out).toContain('42');
  });

  it('renders field errors next to the input', () => {
    expect(out).toContain('Too short');
    expect(out).toContain('class="field-error"');
  });
});

describe('Form with fieldsets', () => {
  const spec = makeResourceSpec({
    fields: [
      makeFieldSpec({ name: 'title', label: 'Title' }),
      makeFieldSpec({ name: 'body', label: 'Body', widget: 'textarea' }),
    ],
    form: {
      fieldsets: [{ label: 'Content', fields: ['title', 'body'] }],
    },
  });

  it('wraps fields in a fieldset with a legend', () => {
    const out = renderFragment(
      Form({
        spec,
        mode: 'create',
        values: {},
        errors: {},
        prefix: '/admin',
        csrfToken: 't',
        action: '/admin/posts',
        method: 'POST',
      }),
    );
    expect(out).toContain('<fieldset');
    expect(out).toContain('<legend>Content</legend>');
  });
});
