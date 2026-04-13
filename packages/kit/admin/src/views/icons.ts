/**
 * Inline SVG icon set. Paths lifted from the Lucide icon family
 * (https://lucide.dev -- ISC licence). Kept in one file so the renderer
 * can ship without webfonts.
 *
 * Unknown names return an empty span so missing icons never crash a page.
 */
import { html } from 'htm/preact';
import type { VNode } from 'preact';

export interface IconProps {
  readonly name: string;
  readonly size?: number;
}

const PATHS: Readonly<Record<string, VNode>> = {
  plus: html`<g>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </g>`,
  pencil: html`<g>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </g>`,
  trash: html`<g>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </g>`,
  search: html`<g>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </g>`,
  'file-text': html`<g>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </g>`,
  users: html`<g>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </g>`,
  database: html`<g>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
  </g>`,
  'log-out': html`<g>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </g>`,
  check: html`<polyline points="20 6 9 17 4 12" />`,
  x: html`<g>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </g>`,
};

export const Icon = ({ name, size = 16 }: IconProps): VNode => {
  const path = PATHS[name];
  if (!path)
    return html`<span
      class="admin-icon admin-icon--missing"
      aria-hidden="true"
    ></span>`;
  return html`<svg
    class="admin-icon"
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${path}
  </svg>`;
};
