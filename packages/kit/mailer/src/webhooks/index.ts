/**
 * Webhook helpers exposed to the consumer's webhook receiver routes.
 * The route does:
 *
 * 1. `verifyAndExtractEvents(provider, transport, headers, rawBody)`
 *    -- runs the per-provider HMAC / Basic-Auth check, returns the
 *    normalised `MailEvent[]` array OR null on signature failure.
 * 2. Persist each event via `mailEventsRepository.append(...)`. Duplicates
 *    are absorbed by the (provider, event_id) UNIQUE constraint.
 * 3. ACK 200 immediately. The async `mail.process-event` worker
 *    converts each row into a `mail_deliveries` status update +
 *    suppression-list row (for hard bounces / complaints).
 *
 * The actual signature verifier lives on each transport
 * (`transport.verifyWebhook(...)`) so the provider-specific quirks
 * (Resend's Svix HMAC, SES's SNS RSA, Postmark's Basic Auth) stay
 * colocated with the send adapter.
 */
import { WebhookVerificationFailed } from '../errors.js';
import type {
  MailEvent,
  MailTransport,
  WebhookVerifyInput,
} from '../transports/types.js';

export type WebhookProvider = 'ses' | 'postmark' | 'resend';

/**
 * Run the verifier on `transport.verifyWebhook(...)`. Throws
 * `WebhookVerificationFailed` on missing or invalid signature so the
 * route can map to HTTP 200 with an empty body (deliberately ambiguous
 * to avoid leaking signature validity to attackers).
 *
 * Returns `[]` for known-valid no-op events (e.g. SES SNS subscription
 * confirmation) so the route can still ACK 200 without enqueueing
 * processor work.
 */
export const verifyAndExtractEvents = (
  transport: MailTransport,
  input: WebhookVerifyInput,
): readonly MailEvent[] => {
  if (!transport.verifyWebhook) {
    throw new WebhookVerificationFailed(
      `Transport "${transport.name}" does not support webhooks`,
    );
  }
  const events = transport.verifyWebhook(input);
  if (events === null) {
    throw new WebhookVerificationFailed();
  }
  return events;
};

export type { MailEvent, WebhookVerifyInput } from '../transports/types.js';
