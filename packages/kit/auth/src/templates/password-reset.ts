/**
 * Placeholder mailer template for the password-reset flow. Pure
 * function -- the consumer renders, then forwards to a mailer adapter.
 *
 * Real delivery lives in `P2.mailer.*`; this file keeps the markup
 * colocated with the flow so the mailer layer only has to know how to
 * send a `KitMailMessage`, not how to format an auth email.
 */
import type { PasswordResetRequestedEvent } from '../auth.service.js';

import {
  buildUrlWithToken,
  escapeHtml,
  formatExpiresAt,
  sanitizeSubjectField,
  type KitMailMessage,
} from './_helpers.js';

export interface RenderPasswordResetOptions {
  /** Absolute URL the user opens to land on the reset form. The token
   * is appended verbatim; pass a trailing `?` or `&` if you don't want
   * the helper to add `?token=...`. */
  readonly resetUrl: string;
  /** Display name for the product. Defaults to a neutral fallback so a
   * missing config still yields a sensible mail. */
  readonly productName?: string;
}

export const renderPasswordResetEmail = (
  event: PasswordResetRequestedEvent,
  options: RenderPasswordResetOptions,
): KitMailMessage => {
  const product = options.productName ?? 'your account';
  const url = buildUrlWithToken(options.resetUrl, event.token);
  const expires = formatExpiresAt(event.expiresAt);
  const subject = `Reset your password for ${sanitizeSubjectField(product)}`;

  const text = [
    `Hello,`,
    ``,
    `We received a request to reset your password.`,
    `Open the link below to choose a new one:`,
    ``,
    url,
    ``,
    `The link expires on ${expires}.`,
    `If you did not request this you can safely ignore this email --`,
    `your password will stay unchanged.`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:system-ui,sans-serif;line-height:1.5;">
    <p>Hello,</p>
    <p>
      We received a request to reset your password for
      <strong>${escapeHtml(product)}</strong>.
    </p>
    <p>
      <a href="${escapeHtml(url)}"
         style="display:inline-block;padding:8px 16px;background:#0b5fff;color:#fff;text-decoration:none;border-radius:4px;">
        Reset password
      </a>
    </p>
    <p style="color:#666;">
      The link expires on ${escapeHtml(expires)}. If the button doesn't
      work, copy this URL into your browser:<br/>
      <code>${escapeHtml(url)}</code>
    </p>
    <p style="color:#666;">
      If you did not request this you can safely ignore this email --
      your password will stay unchanged.
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
