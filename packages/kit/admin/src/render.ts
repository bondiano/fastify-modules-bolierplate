/**
 * Rendering entry point for @kit/admin. Re-exports `html` from htm/preact
 * (the tagged template used by every view) and wraps
 * `preact-render-to-string` for fragment + full-page serialisation.
 *
 * The admin panel runs under `node --watch --experimental-strip-types`,
 * which strips TS types but does NOT transform JSX. Every view in this
 * package therefore uses `html` tagged templates and never JSX.
 */
import type { VNode } from 'preact';
import { renderToString } from 'preact-render-to-string';

import { Layout } from './views/layout.js';

export { html } from 'htm/preact';

export interface PageRenderContext {
  readonly title: string;
  readonly assetPrefix: string;
  readonly csrfToken: string;
  /** Pre-computed nav items ordered left-to-right / top-to-bottom. */
  readonly nav: readonly NavItem[];
  readonly user?: { readonly email: string; readonly role: string };
  readonly flash?: {
    readonly kind: 'success' | 'error';
    readonly message: string;
  };
  /**
   * Active tenant + switcher metadata. Populated by
   * `buildRenderContext` only when the request carries a tenant frame
   * (or when memberships are detectable via the cradle); the layout
   * hides the block entirely when omitted, so single-tenant deployments
   * pay no visual cost.
   */
  readonly tenant?: TenantBlock;
}

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly active: boolean;
  /**
   * Side-nav group label. Items sharing the same `group` are rendered
   * under a common heading; `null` items appear at the top level above
   * any groups. Mirrors `AdminResourceSpec.group`.
   */
  readonly group: string | null;
}

export interface TenantCurrent {
  readonly id: string;
  readonly label: string;
}

export interface TenantBlock {
  /** `null` when the user has not picked a tenant yet. */
  readonly current: TenantCurrent | null;
  readonly switcherUrl: string;
  /** `true` when the user has > 1 membership and the switcher is useful. */
  readonly canSwitch: boolean;
}

/**
 * Serialise a VNode as an HTML fragment. No doctype, no `<html>` wrapper.
 * Used for htmx swap targets.
 */
export const renderFragment = (vnode: VNode): string => renderToString(vnode);

/**
 * Serialise a VNode wrapped in the full page chrome, prefixed with the
 * HTML5 doctype. Used for the initial full-page loads.
 */
export const renderPage = (ctx: PageRenderContext, body: VNode): string => {
  const tree = Layout({ ctx, body });
  return `<!doctype html>\n${renderToString(tree)}`;
};
