/**
 * Shared template helpers used by every `@kit/mailer` template renderer
 * AND by upstream packages (`@kit/auth`, `@kit/tenancy`) that ship their
 * own callback-event shapes. Hosted here -- not in those packages --
 * because the mail layer is the dependency target; auth/tenancy import
 * from us.
 *
 * Originally lived at `@kit/auth/src/templates/_helpers.ts` (P2.auth.6);
 * moved 2026-05-06 as part of P2.mailer.11.
 *
 * The control-character regex is built from explicit `String.fromCodePoint`
 * boundaries so this source file stays free of raw control bytes (those
 * tend to get mangled by editors / formatters / Git on round-trip).
 */

const buildControlCharsRe = (): RegExp => {
  const lo = String.fromCodePoint(0x00);
  const hi = String.fromCodePoint(0x1f);
  const del = String.fromCodePoint(0x7f);
  return new RegExp(`[${lo}-${hi}${del}]`, 'g');
};

const CONTROL_CHARS_RE = buildControlCharsRe();

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
};
const HTML_ESCAPE_RE = /[&<>"'`=]/g;

export const escapeHtml = (s: string): string =>
  s
    .replaceAll(CONTROL_CHARS_RE, '')
    .replaceAll(HTML_ESCAPE_RE, (ch) => HTML_ESCAPES[ch] ?? ch);

export const sanitizeSubjectField = (s: string): string =>
  s.replaceAll(CONTROL_CHARS_RE, '').trim();

export const formatExpiresAt = (date: Date): string => date.toUTCString();

export const buildUrlWithToken = (base: string, token: string): string => {
  if (base.endsWith('?') || base.endsWith('&')) return `${base}token=${token}`;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}token=${token}`;
};

/**
 * The minimal payload every renderer must produce. Kept tiny so it can
 * live as a stable contract between the renderer and the transport
 * adapter (the transport layer adds `from`, `replyTo`, `attachments`
 * etc. on top -- see `MailMessage`).
 */
export interface KitMailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * The full payload accepted by `MailTransport.send(...)`. Strict
 * superset of `KitMailMessage` -- the additional fields are populated
 * by `mailerService` from the per-tenant `from` override + headers /
 * attachments declared on the registered template.
 */
export interface MailMessage extends KitMailMessage {
  readonly from: string;
  readonly fromName?: string;
  readonly replyTo?: string;
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly tags?: readonly string[];
  readonly attachments?: readonly {
    readonly filename: string;
    readonly content: Buffer | string;
    readonly contentType?: string;
  }[];
}
