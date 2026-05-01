/**
 * Full-page admin layout. Renders the <html> shell: meta tags, vendored
 * htmx script, CSRF meta tag, side nav, header, main, and flash toast.
 *
 * Import `html` directly from `htm/preact` (not from `../render.js`) to
 * avoid a module cycle: render.ts imports Layout, Layout would otherwise
 * import render.ts.
 */
import { html } from 'htm/preact';
import type { VNode } from 'preact';

import type { PageRenderContext } from '../render.js';

export interface LayoutProps {
  readonly ctx: PageRenderContext;
  readonly body: VNode;
}

export const Layout = ({ ctx, body }: LayoutProps): VNode => {
  const cssHref = `${ctx.assetPrefix}/admin.css`;
  const jsHref = `${ctx.assetPrefix}/htmx.min.js`;
  const userBlock = ctx.user
    ? html`<div class="admin-user">
        <span class="admin-user__email">${ctx.user.email}</span>
        <span class="admin-user__role muted">${ctx.user.role}</span>
        <form method="post" action="/admin/logout" class="admin-logout">
          <button type="submit" class="btn btn-secondary">Log out</button>
        </form>
      </div>`
    : null;

  const tenantBlock = ctx.tenant
    ? html`<div class="admin-tenant">
        <span class="admin-tenant__label muted">Tenant</span>
        <span class="admin-tenant__name">
          ${ctx.tenant.current ? ctx.tenant.current.label : 'Not selected'}
        </span>
        ${ctx.tenant.canSwitch || !ctx.tenant.current
          ? html`<a
              href=${ctx.tenant.switcherUrl}
              class="admin-tenant__switch btn btn-secondary"
              hx-get=${ctx.tenant.switcherUrl}
              hx-target="#admin-main"
              hx-swap="innerHTML"
              hx-push-url="true"
            >
              ${ctx.tenant.current ? 'Switch' : 'Pick tenant'}
            </a>`
          : null}
      </div>`
    : null;

  const flashBlock = ctx.flash
    ? html`<div
        class=${`admin-flash admin-flash--${ctx.flash.kind}`}
        role="status"
      >
        ${ctx.flash.message}
      </div>`
    : null;

  // Resources without a `group` go up top; everything else is bucketed
  // under its group label, alphabetised so the rendering is stable.
  type NavItem = (typeof ctx.nav)[number];
  const ungrouped: NavItem[] = [];
  const grouped: Record<string, NavItem[]> = {};
  for (const item of ctx.nav) {
    if (item.group === null) {
      ungrouped.push(item);
      continue;
    }
    (grouped[item.group] ??= []).push(item);
  }
  const groupNames = Object.keys(grouped).toSorted((a, b) =>
    a.localeCompare(b),
  );

  const renderItem = (item: (typeof ctx.nav)[number]) =>
    html`<li>
      <a
        href=${item.href}
        class=${item.active
          ? 'admin-nav__link admin-nav__link--active'
          : 'admin-nav__link'}
        hx-get=${item.href}
        hx-target="#admin-main"
        hx-swap="innerHTML"
        hx-push-url="true"
      >
        ${item.label}
      </a>
    </li>`;

  const ungroupedItems = ungrouped.map((item) => renderItem(item));
  const groupSections = groupNames.map(
    (name) =>
      html`<li class="admin-nav__group">
        <div class="admin-nav__group-label">${name}</div>
        <ul class="admin-nav__group-list">
          ${grouped[name]!.map((item) => renderItem(item))}
        </ul>
      </li>`,
  );
  const navItems = [...ungroupedItems, ...groupSections];

  return html`<html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${ctx.title}</title>
      <meta name="csrf-token" content=${ctx.csrfToken} />
      <link rel="stylesheet" href=${cssHref} />
      <script src=${jsHref} defer></script>
      <script src=${`${ctx.assetPrefix}/admin.js`} defer></script>
    </head>
    <body>
      <header class="admin-header">
        <div class="admin-header__title">${ctx.title}</div>
        ${tenantBlock} ${userBlock}
      </header>
      <div class="admin-shell">
        <nav class="admin-nav" aria-label="Admin sections">
          <ul class="admin-nav__list">
            ${navItems}
          </ul>
        </nav>
        <main id="admin-main" class="admin-main">${body}</main>
      </div>
      <div id="admin-toast" class="admin-toast" aria-live="polite">
        ${flashBlock}
      </div>
    </body>
  </html>`;
};
