/**
 * Placeholder mailer template for OTP delivery. Renders a 6-digit code
 * inline in both the subject (omitted for security -- subject is
 * surfaced in notification panes / lock-screen previews) and the body.
 */
import type { OtpRequestedEvent } from '../auth.service.js';

import {
  escapeHtml,
  formatExpiresAt,
  sanitizeSubjectField,
  type KitMailMessage,
} from './_helpers.js';

export interface RenderOtpOptions {
  readonly productName?: string;
}

export const renderOtpEmail = (
  event: OtpRequestedEvent,
  options: RenderOtpOptions = {},
): KitMailMessage => {
  const product = options.productName ?? 'your account';
  const expires = formatExpiresAt(event.expiresAt);
  // Deliberately do NOT include the code in the subject -- iOS / Android
  // surface previews on the lock screen, and treating the OTP as "subject
  // metadata" defeats the second factor.
  const subject = `Your verification code for ${sanitizeSubjectField(product)}`;

  const text = [
    `Hello,`,
    ``,
    `Your one-time verification code is:`,
    ``,
    event.code,
    ``,
    `The code expires on ${expires}.`,
    `If you did not request this you can safely ignore this email.`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:system-ui,sans-serif;line-height:1.5;">
    <p>Hello,</p>
    <p>Your one-time verification code is:</p>
    <p style="font-size:24px;font-weight:600;letter-spacing:0.18em;font-family:ui-monospace,monospace;">
      ${escapeHtml(event.code)}
    </p>
    <p style="color:#666;">
      The code expires on ${escapeHtml(expires)}.
    </p>
    <p style="color:#666;">
      If you did not request this you can safely ignore this email.
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
