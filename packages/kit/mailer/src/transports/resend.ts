/**
 * Resend transport. Resend SDK is an optional peer-dep -- we lazy-load
 * it so consumers using a different provider don't need it installed.
 *
 * Webhook verification: Resend signs every webhook with HMAC-SHA256
 * over the raw body using the workspace webhook secret. Implementation
 * follows the Svix spec they use:
 *   https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { MailerNotConfigured } from '../errors.js';
import type { MailMessage } from '../templates/_helpers.js';

import type {
  MailEvent,
  MailEventType,
  MailTransport,
  SendOptions,
  SendResult,
  WebhookVerifyInput,
} from './types.js';

export interface ResendTransportOptions {
  readonly apiKey: string;
  readonly webhookSecret?: string;
}

interface ResendLike {
  emails: {
    send(input: ResendSendInput): Promise<ResendSendResult>;
  };
}

interface ResendSendInput {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  attachments?: { filename: string; content: Buffer | string }[];
}

interface ResendSendResult {
  data?: { id: string } | null;
  error?: { name: string; message: string } | null;
}

interface ResendCtor {
  new (apiKey: string): ResendLike;
}

const loadResend = async (): Promise<ResendCtor> => {
  try {
    const module_ = (await import('resend')) as unknown as {
      Resend?: ResendCtor;
    };
    if (!module_.Resend) {
      throw new MailerNotConfigured(
        'Resend SDK exports `Resend` class but it is missing -- check the installed version.',
      );
    }
    return module_.Resend;
  } catch (error) {
    if (error instanceof MailerNotConfigured) throw error;
    throw new MailerNotConfigured(
      'Install `resend` to use the resend transport (`pnpm add -D resend`).',
    );
  }
};

// 5xx, 408, 429 are retryable per Resend API conventions.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const parseStatusFromError = (errorName: string | undefined): number | null => {
  if (!errorName) return null;
  // Resend errors carry a `name` like 'rate_limit_exceeded' (HTTP 429).
  // We map a small set; everything else falls through to non-retryable.
  if (errorName === 'rate_limit_exceeded') return 429;
  if (errorName === 'internal_server_error') return 500;
  return null;
};

export const createResendTransport = (
  options: ResendTransportOptions,
): MailTransport => {
  let cached: ResendLike | null = null;

  const getClient = async (): Promise<ResendLike> => {
    if (cached) return cached;
    const Resend = await loadResend();
    cached = new Resend(options.apiKey);
    return cached;
  };

  return {
    name: 'resend',
    async send(message: MailMessage, opts: SendOptions): Promise<SendResult> {
      try {
        const client = await getClient();
        const result = await client.emails.send({
          from: message.fromName
            ? `${message.fromName} <${message.from}>`
            : message.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          ...(message.cc ? { cc: [...message.cc] } : {}),
          ...(message.bcc ? { bcc: [...message.bcc] } : {}),
          ...(message.headers
            ? {
                headers: {
                  ...message.headers,
                  'X-Idempotency-Key': opts.idempotencyKey,
                },
              }
            : { headers: { 'X-Idempotency-Key': opts.idempotencyKey } }),
          ...(message.tags
            ? {
                tags: message.tags.map((tag) => ({ name: 'kit', value: tag })),
              }
            : {}),
        });
        if (result.error) {
          const status = parseStatusFromError(result.error.name);
          return {
            ok: false,
            retryable: status === null ? false : RETRYABLE_STATUS.has(status),
            code: result.error.name,
            message: result.error.message,
          };
        }
        if (!result.data?.id) {
          return {
            ok: false,
            retryable: true,
            code: 'RESEND_EMPTY_RESPONSE',
            message: 'Resend returned no error and no message id',
          };
        }
        return { ok: true, providerMessageId: result.data.id };
      } catch (error) {
        const meta = error as { name?: string; message?: string } | null;
        return {
          ok: false,
          // Network / DNS errors thrown out of the SDK are retryable.
          retryable: true,
          code: meta?.name ?? 'RESEND_SEND_FAILED',
          message: meta?.message ?? 'Resend send failed',
        };
      }
    },
    verifyWebhook(input: WebhookVerifyInput): readonly MailEvent[] | null {
      if (!options.webhookSecret) return null;
      const sigHeader = input.headers['svix-signature'];
      const idHeader = input.headers['svix-id'];
      const tsHeader = input.headers['svix-timestamp'];
      const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
      const id = Array.isArray(idHeader) ? idHeader[0] : idHeader;
      const ts = Array.isArray(tsHeader) ? tsHeader[0] : tsHeader;
      if (!sig || !id || !ts) return null;

      const signed = `${id}.${ts}.${input.rawBody.toString('utf8')}`;
      const secretB64 = options.webhookSecret.startsWith('whsec_')
        ? options.webhookSecret.slice('whsec_'.length)
        : options.webhookSecret;
      const expected = createHmac('sha256', Buffer.from(secretB64, 'base64'))
        .update(signed)
        .digest('base64');
      // Resend ships multiple `v1,<sig>` pairs space-separated. Compare
      // against each in constant time; bail on first match.
      const candidates = sig
        .split(' ')
        .map((s) => s.split(','))
        .filter((parts) => parts.length === 2 && parts[0] === 'v1')
        .map((parts) => parts[1]!);
      const matched = candidates.some((candidate) => {
        try {
          return timingSafeEqual(
            Buffer.from(candidate, 'base64'),
            Buffer.from(expected, 'base64'),
          );
        } catch {
          return false;
        }
      });
      if (!matched) return null;

      let payload: ResendWebhookPayload;
      try {
        payload = JSON.parse(
          input.rawBody.toString('utf8'),
        ) as ResendWebhookPayload;
      } catch {
        return null;
      }
      const event = mapResendEvent(payload, id);
      return event ? [event] : [];
    },
  };
};

interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    to: string[] | string;
    bounce?: { type?: 'hard' | 'soft' | 'transient'; subType?: string };
    [key: string]: unknown;
  };
}

const TYPE_MAP: Readonly<Record<string, MailEventType>> = {
  'email.delivered': 'delivered',
  'email.complained': 'complained',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
};

const mapResendEvent = (
  payload: ResendWebhookPayload,
  eventId: string,
): MailEvent | null => {
  const recipient = Array.isArray(payload.data.to)
    ? (payload.data.to[0] ?? '')
    : payload.data.to;
  const occurredAt = new Date(payload.created_at);
  if (payload.type === 'email.bounced') {
    const isHard = payload.data.bounce?.type === 'hard';
    return {
      type: isHard ? 'bounced.hard' : 'bounced.soft',
      providerMessageId: payload.data.email_id,
      providerEventId: eventId,
      occurredAt,
      recipient,
      reason: payload.data.bounce?.subType,
    };
  }
  const mapped = TYPE_MAP[payload.type];
  if (!mapped) return null;
  return {
    type: mapped,
    providerMessageId: payload.data.email_id,
    providerEventId: eventId,
    occurredAt,
    recipient,
  };
};
