/**
 * Placeholder mailer template for the email-verification flow. Pure
 * function -- the consumer renders, then forwards to a mailer adapter.
 */
import type { EmailVerificationRequestedEvent } from '../auth.service.js';

import {
  buildUrlWithToken,
  escapeHtml,
  formatExpiresAt,
  sanitizeSubjectField,
  type KitMailMessage,
} from './_helpers.js';

export interface RenderEmailVerificationOptions {
  /** Absolute URL the user opens to confirm ownership of their email.
   * Token is appended via `?token=...` (or `&token=...` when the URL
   * already carries query params). */
  readonly verifyUrl: string;
  readonly productName?: string;
}

export const renderEmailVerificationEmail = (
  event: EmailVerificationRequestedEvent,
  options: RenderEmailVerificationOptions,
): KitMailMessage => {
  const product = options.productName ?? 'your account';
  const url = buildUrlWithToken(options.verifyUrl, event.token);
  const expires = formatExpiresAt(event.expiresAt);
  const subject = `Confirm your email for ${sanitizeSubjectField(product)}`;

  const text = [
    `Hello,`,
    ``,
    `Please confirm that ${event.email} is your email address`,
    `by opening the link below:`,
    ``,
    url,
    ``,
    `The link expires on ${expires}.`,
    `If you did not create an account you can safely ignore this email.`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:system-ui,sans-serif;line-height:1.5;">
    <p>Hello,</p>
    <p>
      Please confirm that <strong>${escapeHtml(event.email)}</strong> is
      your email address on <strong>${escapeHtml(product)}</strong>.
    </p>
    <p>
      <a href="${escapeHtml(url)}"
         style="display:inline-block;padding:8px 16px;background:#0b5fff;color:#fff;text-decoration:none;border-radius:4px;">
        Confirm email
      </a>
    </p>
    <p style="color:#666;">
      The link expires on ${escapeHtml(expires)}. If the button doesn't
      work, copy this URL into your browser:<br/>
      <code>${escapeHtml(url)}</code>
    </p>
    <p style="color:#666;">
      If you did not create an account you can safely ignore this email.
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
