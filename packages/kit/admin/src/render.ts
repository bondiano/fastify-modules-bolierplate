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
  readonly nav: readonly {
    readonly href: string;
    readonly label: string;
    readonly active: boolean;
  }[];
  readonly user?: { readonly email: string; readonly role: string };
  readonly flash?: {
    readonly kind: 'success' | 'error';
    readonly message: string;
  };
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
