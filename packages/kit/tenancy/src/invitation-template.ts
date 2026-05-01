/**
 * Placeholder mailer template for the invitation accept email.
 *
 * Generates a structured `{ subject, text, html }` payload from an
 * `InvitationCreatedEvent`. Real delivery lives in `P2.mailer.*`; this
 * keeps the markup colocated with the domain so the mailer adapter only
 * needs to know how to send a `MailMessage`, not how to format an
 * invitation.
 *
 * The accept URL must be supplied by the consumer -- the tenancy package
 * doesn't know whether the service exposes accept under `/auth/invite`,
 * `/api/invitations/accept`, or somewhere else, and the host header
 * rewriting is the consumer's call.
 */
import type { InvitationCreatedEvent } from './memberships-service.js';

export interface InvitationMailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface RenderInvitationOptions {
  /**
   * Absolute URL the invitee opens to redeem the token. The token is
   * appended verbatim -- include any query-string base ending in a
   * separator (`?` or `&`) only if you don't want the helper to add
   * `?token=...`.
   */
  readonly acceptUrl: string;
  /**
   * Display name for the tenant (`tenants.name`). Optional -- when
   * omitted the message refers to "a workspace" so the helper stays
   * usable in pre-tenant contexts.
   */
  readonly tenantName?: string;
  /** Display name for the inviter, when known. */
  readonly invitedByName?: string;
  /**
   * Product name shown in the subject line. Defaults to `'the workspace'`
   * so a missing config still yields a sensible mail.
   */
  readonly productName?: string;
}

const buildAcceptUrl = (base: string, token: string): string => {
  if (base.endsWith('?') || base.endsWith('&')) return `${base}token=${token}`;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}token=${token}`;
};

/**
 * ASCII control characters (U+0000-U+001F plus DEL U+007F). Mail clients
 * render most of these as garbage and CR/LF in particular lets a
 * malicious value inject MIME headers when the field reaches a
 * `Subject:` line. The template's input fields are short display strings
 * (tenant name, role, inviter name), so dropping all control chars is
 * safer than trying to whitelist tab/newline.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;

/**
 * Escape characters that are unsafe in **HTML body** AND **attribute**
 * contexts. The canonical OWASP body set is `& < > " '`; we add backtick
 * and `=` for defence-in-depth -- they break attribute parsing in
 * unquoted-attribute contexts. The template uses quoted attributes
 * everywhere, but the helper is exported and may be reused.
 */
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

const escapeHtml = (s: string): string =>
  s
    .replaceAll(CONTROL_CHARS_RE, '')
    .replaceAll(HTML_ESCAPE_RE, (ch) => HTML_ESCAPES[ch] ?? ch);

const formatExpiresAt = (date: Date): string => {
  // `Date.prototype.toUTCString` gives a stable, locale-independent format
  // -- fine for a transactional email until the consumer wires real i18n.
  return date.toUTCString();
};

/**
 * Sanitize a short display string before it lands in the `Subject:`
 * line. Strips CR/LF and other control bytes that would let a hostile
 * value inject extra MIME headers; trims surrounding whitespace.
 */
const sanitizeSubjectField = (s: string): string =>
  s.replaceAll(CONTROL_CHARS_RE, '').trim();

/**
 * Render an invitation event into a transactional-email payload. Pure
 * function -- no IO, no globals -- so the consumer can test the mailer
 * adapter and the template independently.
 */
export const renderInvitationEmail = (
  event: InvitationCreatedEvent,
  options: RenderInvitationOptions,
): InvitationMailMessage => {
  const tenant = options.tenantName ?? 'a workspace';
  const product = options.productName ?? 'the workspace';
  const inviter = options.invitedByName ?? 'an administrator';
  const url = buildAcceptUrl(options.acceptUrl, event.token);
  const expires = formatExpiresAt(event.expiresAt);

  const subject = `You're invited to join ${sanitizeSubjectField(tenant)}`;

  const text = [
    `Hello,`,
    ``,
    `${inviter} invited you to join ${tenant} on ${product} as ${event.role}.`,
    `Open the link below to accept the invitation:`,
    ``,
    url,
    ``,
    `The invitation expires on ${expires}.`,
    `If you did not expect this email you can safely ignore it.`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:system-ui,sans-serif;line-height:1.5;">
    <p>Hello,</p>
    <p>
      ${escapeHtml(inviter)} invited you to join
      <strong>${escapeHtml(tenant)}</strong> on
      ${escapeHtml(product)} as <strong>${escapeHtml(event.role)}</strong>.
    </p>
    <p>
      <a href="${escapeHtml(url)}"
         style="display:inline-block;padding:8px 16px;background:#0b5fff;color:#fff;text-decoration:none;border-radius:4px;">
        Accept invitation
      </a>
    </p>
    <p style="color:#666;">
      The invitation expires on ${escapeHtml(expires)}. If the button
      doesn't work, copy this URL into your browser:<br/>
      <code>${escapeHtml(url)}</code>
    </p>
    <p style="color:#666;">
      If you did not expect this email you can safely ignore it.
    </p>
  </body>
</html>`;

  return {
    to: event.email,
    subject,
    text,
    html,
  };
};
