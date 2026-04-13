import { describe, expect, it } from 'vitest';

import { html, renderFragment, renderPage } from './render.js';

describe('renderFragment', () => {
  it('serialises a simple VNode to HTML', () => {
    const value = 'hello';
    const vnode = html`<p>${value}</p>`;
    expect(renderFragment(vnode)).toBe('<p>hello</p>');
  });

  it('escapes dangerous interpolations', () => {
    const evil = '<script>alert(1)</script>';
    const out = renderFragment(html`<div>${evil}</div>`);
    expect(out).toContain('&lt;script');
    expect(out).not.toContain('<script>alert');
  });
});

describe('renderPage', () => {
  const ctx = {
    title: 'Admin',
    assetPrefix: '/admin/_assets',
    csrfToken: 'tok-123',
    nav: [{ href: '/admin/posts', label: 'Posts', active: true }],
  };

  it('prepends the HTML5 doctype', () => {
    const out = renderPage(ctx, html`<p>body</p>`);
    expect(out.startsWith('<!doctype html>\n')).toBe(true);
  });

  it('includes the body, title, csrf meta, and nav entry', () => {
    const out = renderPage(ctx, html`<p class="marker">body</p>`);
    expect(out).toContain('<title>Admin</title>');
    expect(out).toContain('name="csrf-token"');
    expect(out).toContain('content="tok-123"');
    expect(out).toContain('href="/admin/_assets/admin.css"');
    expect(out).toContain('src="/admin/_assets/htmx.min.js"');
    expect(out).toContain('<p class="marker">body</p>');
    expect(out).toContain('Posts');
  });
});
