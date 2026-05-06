/**
 * Provider-agnostic transport contract. Adapters in `transports/{smtp,
 * ses, resend, postmark, dev-memory}.ts` implement this; the mailer
 * worker calls a single `transport.send(message, opts)` regardless of
 * which provider is configured.
 *
 * `SendResult` is a discriminated union (not thrown errors) so the
 * worker can branch cleanly on retryable vs fatal -- see
 * `mail-send.job.ts`. Vendor SDKs that throw on network failure get
 * caught and translated inside the adapter.
 */
import type { MailMessage } from '../templates/_helpers.js';

export type TransportName =
  | 'smtp'
  | 'ses'
  | 'resend'
  | 'postmark'
  | 'dev-memory';

export type SendResult =
  | { readonly ok: true; readonly providerMessageId: string }
  | {
      readonly ok: false;
      /** When `true`, BullMQ should retry with exponential backoff.
       * Network failures, 5xx responses, throttle errors. */
      readonly retryable: boolean;
      /** Stable error code (HTTP status, AWS error name, etc) -- stored
       * on `mail_deliveries.last_error_code` for forensic queries. */
      readonly code: string;
      /** Human-readable error message -- stored on `last_error_message`. */
      readonly message: string;
    };

export interface SendOptions {
  /** Same key persisted on `mail_deliveries.idempotency_key`. Some
   * providers (Postmark, Resend) accept it as a header to dedupe on
   * their side too. */
  readonly idempotencyKey: string;
}

/**
 * Webhook event normalized across providers. Each transport's
 * `verifyWebhook(...)` returns one or more events; the worker updates
 * `mail_deliveries.status` and the suppression list accordingly.
 */
export type MailEventType =
  | 'delivered'
  | 'bounced.hard'
  | 'bounced.soft'
  | 'complained'
  | 'opened'
  | 'clicked'
  | 'unsubscribed';

export interface MailEvent {
  readonly type: MailEventType;
  readonly providerMessageId: string;
  readonly providerEventId: string;
  readonly occurredAt: Date;
  readonly recipient: string;
  /** Provider-specific reason text. `undefined` when the provider didn't
   * surface one (e.g. `delivered` events). */
  readonly reason?: string | undefined;
}

export interface WebhookVerifyInput {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly rawBody: Buffer;
}

export interface MailTransport {
  readonly name: TransportName;
  send(message: MailMessage, opts: SendOptions): Promise<SendResult>;
  /** Provider-specific webhook decoder. Returns `null` when the
   * transport does NOT ship a webhook receiver (e.g. SMTP, dev-memory).
   * Returns `[]` when the request is valid but contains no actionable
   * events (e.g. SES SNS subscription confirmation -- handled by
   * confirming the subscription as a side-effect). */
  verifyWebhook?(input: WebhookVerifyInput): readonly MailEvent[] | null;
}
