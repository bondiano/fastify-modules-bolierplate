/**
 * Template renderer. Reads compiled HTML + plain-text fallback from disk
 * (the build step in `tools/compile-mjml.ts` produces them) and applies
 * Handlebars-style `{{var}}` interpolation with **HTML escape on by
 * default**. The escape policy mirrors the OWASP HTML Encoding Cheat
 * Sheet -- ampersand, angle brackets, quotes, backtick, equals.
 *
 * Triple-stash `{{{raw}}}` is intentionally NOT supported -- raw HTML
 * interpolation in mail templates is a phishing footgun. If a template
 * needs to embed pre-rendered HTML, build it in code and pass it
 * through `sendRaw(...)` instead.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MailerNotConfigured } from '../errors.js';

import { escapeHtml, type KitMailMessage } from './_helpers.js';
import { getRegisteredTemplate, type MailLocale } from './registry.js';

/**
 * Override directory at runtime when the consumer ships its own
 * compiled templates (e.g. a service that adds custom seed templates).
 * Defaults to `dist/templates/compiled/` resolved from this module's
 * own directory at runtime -- which lands inside `@kit/mailer`'s own
 * dist tree after `pnpm build`.
 */
let templatesDirOverride: string | null = null;

export const setTemplatesDir = (dir: string | null): void => {
  templatesDirOverride = dir;
};

const defaultTemplatesDir = (): string => {
  // dist/templates/compiled/<name>.html sibling to this file's dist
  // location (`dist/templates/render.js`). The build step in
  // `tools/compile-mjml.ts` writes there.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, 'compiled');
};

const HANDLEBARS_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

const lookup = (
  payload: Record<string, unknown>,
  pathExpr: string,
): unknown => {
  const parts = pathExpr.split('.');
  let cursor: unknown = payload;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
};

const formatScalar = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toUTCString();
  if (typeof value === 'string') return value;
  return String(value);
};

/**
 * Apply Handlebars-style interpolation. Always HTML-escapes the value
 * before substitution. `escape: false` skips the escape (used by the
 * plain-text variant where escape would corrupt the output).
 */
export const interpolate = (
  template: string,
  payload: Record<string, unknown>,
  options: { readonly escape: boolean } = { escape: true },
): string =>
  template.replaceAll(HANDLEBARS_RE, (_match, expr: string) => {
    const value = formatScalar(lookup(payload, expr));
    return options.escape ? escapeHtml(value) : value;
  });

const cache = new Map<string, { html: string; text: string }>();

const loadCompiled = async (
  name: string,
): Promise<{ html: string; text: string }> => {
  const cached = cache.get(name);
  if (cached) return cached;
  const dir = templatesDirOverride ?? defaultTemplatesDir();
  const htmlPath = path.join(dir, `${name}.html`);
  const textPath = path.join(dir, `${name}.txt`);
  let html: string;
  let text: string;
  try {
    html = await fs.readFile(htmlPath, 'utf8');
  } catch {
    throw new MailerNotConfigured(
      `Compiled template not found: ${htmlPath}. Did you run \`pnpm --filter @kit/mailer build:templates\`?`,
    );
  }
  try {
    text = await fs.readFile(textPath, 'utf8');
  } catch {
    throw new MailerNotConfigured(
      `Plain-text fallback not found: ${textPath}. Each MJML template must ship a hand-written .txt sibling.`,
    );
  }
  const entry = { html, text };
  cache.set(name, entry);
  return entry;
};

/** Test-only: drop the on-disk read cache so a new compile cycle is
 * picked up between `vitest run` invocations of the same worker. */
export const _resetRenderCache = (): void => cache.clear();

export interface RenderOptions<K extends keyof MailTemplates> {
  readonly to: string;
  readonly payload: MailTemplates[K];
  readonly locale?: MailLocale;
}

export const renderTemplate = async <K extends keyof MailTemplates>(
  name: K,
  options: RenderOptions<K>,
): Promise<KitMailMessage> => {
  const entry = getRegisteredTemplate(name);
  if (!entry) {
    throw new MailerNotConfigured(
      `Template "${String(name)}" is not registered. Did you import its module so \`defineTemplate\` ran?`,
    );
  }
  const { html, text } = await loadCompiled(String(name));
  const payloadAsRecord = options.payload as unknown as Record<string, unknown>;
  return {
    to: options.to,
    subject: interpolate(entry.subject, payloadAsRecord, { escape: false }),
    html: interpolate(html, payloadAsRecord, { escape: true }),
    text: interpolate(text, payloadAsRecord, { escape: false }),
  };
};
