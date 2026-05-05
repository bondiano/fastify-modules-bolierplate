/**
 * Shared template helpers for the auth flow renderers (password-reset,
 * email-verify, OTP). Mirrors `@kit/tenancy`'s invitation-template
 * escape rules so a single sanitisation policy applies to every kit
 * email payload.
 *
 * The control-character regex is built from explicit `String.fromCharCode`
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

export interface KitMailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}
