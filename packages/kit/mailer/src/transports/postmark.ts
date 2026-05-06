/**
 * Postmark transport. Postmark SDK is an optional peer-dep -- lazy-loaded.
 *
 * Webhook auth: Postmark does NOT sign webhooks. The recommended setup
 * is HTTP Basic Auth + IP allowlist. We support Basic Auth here; the
 * IP allowlist is a Fastify-level concern (consumer wires it via their
 * proxy / CDN).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { MailerNotConfigured } from '../errors.js';
import type { MailMessage } from '../templates/_helpers.js';

import type {
  MailEvent,
  MailTransport,
  SendOptions,
  SendResult,
  WebhookVerifyInput,
} from './types.js';

export interface PostmarkTransportOptions {
  readonly serverToken: string;
  /** HTTP Basic Auth username for inbound webhooks. */
  readonly webhookUser?: string;
  /** HTTP Basic Auth password for inbound webhooks. */
  readonly webhookPassword?: string;
}

interface PostmarkClientLike {
  sendEmail(input: PostmarkSendInput): Promise<PostmarkSendResult>;
}

interface PostmarkSendInput {
  From: string;
  To: string;
  Subject: string;
  HtmlBody: string;
  TextBody: string;
  ReplyTo?: string;
  Cc?: string;
  Bcc?: string;
  Headers?: { Name: string; Value: string }[];
  Tag?: string;
  MessageStream?: string;
}

interface PostmarkSendResult {
  ErrorCode: number;
  Message: string;
  MessageID: string;
  SubmittedAt?: string;
  To?: string;
}

interface PostmarkClientCtor {
  new (serverToken: string): PostmarkClientLike;
}

const loadPostmark = async (): Promise<PostmarkClientCtor> => {
  try {
    const module_ = (await import('postmark')) as unknown as {
      ServerClient?: PostmarkClientCtor;
    };
    if (!module_.ServerClient) {
      throw new MailerNotConfigured(
        'Postmark SDK exports `ServerClient` but it is missing -- check the installed version.',
      );
    }
    return module_.ServerClient;
  } catch (error) {
    if (error instanceof MailerNotConfigured) throw error;
    throw new MailerNotConfigured(
      'Install `postmark` to use the postmark transport (`pnpm add -D postmark`).',
    );
  }
};

// Postmark API error codes; full list at
// https://postmarkapp.com/developer/api/overview#error-codes. We treat
// rate-limit (415) and server errors as retryable; everything else
// (validation, suppression, etc.) as fatal.
const RETRYABLE_CODES = new Set([100, 405, 415]);

export const createPostmarkTransport = (
  options: PostmarkTransportOptions,
): MailTransport => {
  let cached: PostmarkClientLike | null = null;

  const getClient = async (): Promise<PostmarkClientLike> => {
    if (cached) return cached;
    const ServerClient = await loadPostmark();
    cached = new ServerClient(options.serverToken);
    return cached;
  };

  return {
    name: 'postmark',
    async send(message: MailMessage, opts: SendOptions): Promise<SendResult> {
      try {
        const client = await getClient();
        const result = await client.sendEmail({
          From: message.fromName
            ? `${message.fromName} <${message.from}>`
            : message.from,
          To: message.to,
          Subject: message.subject,
          HtmlBody: message.html,
          TextBody: message.text,
          ...(message.replyTo ? { ReplyTo: message.replyTo } : {}),
          ...(message.cc ? { Cc: message.cc.join(',') } : {}),
          ...(message.bcc ? { Bcc: message.bcc.join(',') } : {}),
          Headers: [
            { Name: 'X-Idempotency-Key', Value: opts.idempotencyKey },
            ...Object.entries(message.headers ?? {}).map(([Name, Value]) => ({
              Name,
              Value,
            })),
          ],
          ...(message.tags && message.tags.length > 0
            ? { Tag: message.tags[0]! }
            : {}),
        });
        if (result.ErrorCode !== 0) {
          return {
            ok: false,
            retryable: RETRYABLE_CODES.has(result.ErrorCode),
            code: `POSTMARK_${result.ErrorCode}`,
            message: result.Message,
          };
        }
        return { ok: true, providerMessageId: result.MessageID };
      } catch (error) {
        const meta = error as { code?: number; message?: string } | null;
        return {
          ok: false,
          // Network / DNS errors are retryable.
          retryable: true,
          code: meta?.code ? `POSTMARK_${meta.code}` : 'POSTMARK_SEND_FAILED',
          message: meta?.message ?? 'Postmark send failed',
        };
      }
    },
    verifyWebhook(input: WebhookVerifyInput): readonly MailEvent[] | null {
      // Basic Auth verification when configured.
      if (options.webhookUser && options.webhookPassword) {
        const auth = input.headers['authorization'];
        const authHeader = Array.isArray(auth) ? auth[0] : auth;
        if (!authHeader || !authHeader.startsWith('Basic ')) return null;
        const decoded = Buffer.from(
          authHeader.slice('Basic '.length),
          'base64',
        ).toString('utf8');
        const expected = `${options.webhookUser}:${options.webhookPassword}`;
        // Hash-then-compare keeps comparison constant-time even when
        // the lengths differ.
        const a = createHash('sha256').update(decoded).digest();
        const b = createHash('sha256').update(expected).digest();
        if (!timingSafeEqual(a, b)) return null;
      }

      let payload: PostmarkWebhookPayload;
      try {
        payload = JSON.parse(
          input.rawBody.toString('utf8'),
        ) as PostmarkWebhookPayload;
      } catch {
        return null;
      }
      const event = mapPostmarkEvent(payload);
      return event ? [event] : [];
    },
  };
};

interface PostmarkWebhookPayload {
  RecordType:
    | 'Delivery'
    | 'Bounce'
    | 'SpamComplaint'
    | 'Open'
    | 'Click'
    | 'SubscriptionChange';
  MessageID: string;
  /** Postmark uses ULIDs for webhook event IDs; falls back to MessageID. */
  ID?: number;
  Email?: string;
  Recipient?: string;
  BouncedAt?: string;
  ReceivedAt?: string;
  DeliveredAt?: string;
  Type?: 'HardBounce' | 'SoftBounce' | 'SpamComplaint' | 'Transient' | string;
  Description?: string;
  /** Open / click events ship `MessageStream` etc. but only the recipient
   * + timing matters for our normaliser. */
}

const mapPostmarkEvent = (
  payload: PostmarkWebhookPayload,
): MailEvent | null => {
  const recipient = payload.Email ?? payload.Recipient ?? '';
  const providerEventId = payload.ID
    ? `pm-${payload.ID}-${payload.RecordType}`
    : `pm-${payload.MessageID}-${payload.RecordType}`;
  const occurredAt = new Date(
    payload.BouncedAt ??
      payload.DeliveredAt ??
      payload.ReceivedAt ??
      Date.now(),
  );
  switch (payload.RecordType) {
    case 'Delivery': {
      return {
        type: 'delivered',
        providerMessageId: payload.MessageID,
        providerEventId,
        occurredAt,
        recipient,
      };
    }
    case 'Bounce': {
      const hard = payload.Type === 'HardBounce';
      return {
        type: hard ? 'bounced.hard' : 'bounced.soft',
        providerMessageId: payload.MessageID,
        providerEventId,
        occurredAt,
        recipient,
        reason: payload.Description,
      };
    }
    case 'SpamComplaint': {
      return {
        type: 'complained',
        providerMessageId: payload.MessageID,
        providerEventId,
        occurredAt,
        recipient,
      };
    }
    case 'Open': {
      return {
        type: 'opened',
        providerMessageId: payload.MessageID,
        providerEventId,
        occurredAt,
        recipient,
      };
    }
    case 'Click': {
      return {
        type: 'clicked',
        providerMessageId: payload.MessageID,
        providerEventId,
        occurredAt,
        recipient,
      };
    }
    default: {
      return null;
    }
  }
};
