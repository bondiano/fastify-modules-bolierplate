/**
 * AWS SES transport via the v2 SDK (`@aws-sdk/client-sesv2`). Lazy-loaded.
 *
 * Webhook verification: SES delivers events through SNS. We accept the
 * SNS POST, verify the payload via the AWS-published `SignatureVersion`
 * 1 / 2 algorithm, auto-confirm subscription requests by GET-ing
 * `SubscribeURL`, and normalise message events into our `MailEvent`
 * shape.
 *
 * The SNS verifier needs an outbound HTTP request (to the SigningCertURL)
 * to validate the signature. We do this in the webhook handler so the
 * route returns 200 fast even if the cert fetch is slow -- the actual
 * processing happens in the `mail.process-event` job AFTER persistence.
 */
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

export interface SesTransportOptions {
  readonly region: string;
  /** Optional explicit credentials. Without these the SDK reads the
   * standard AWS credential chain (env, profile, IAM role). */
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  /** SNS topic ARN -- used by the webhook receiver to reject events
   * arriving on a different topic. */
  readonly snsTopicArn?: string;
}

interface SesClientLike {
  send(command: SesSendCommandLike): Promise<SesSendResult>;
}

interface SesSendCommandLike {
  /** v3 commands are tagged objects whose constructor name we don't
   * inspect -- we only care about the payload they wrap. */
  readonly input: SesSendInput;
}

interface SesSendInput {
  FromEmailAddress: string;
  Destination: {
    ToAddresses: string[];
    CcAddresses?: string[];
    BccAddresses?: string[];
  };
  ReplyToAddresses?: string[];
  Content: {
    Simple: {
      Subject: { Data: string; Charset: 'UTF-8' };
      Body: {
        Html: { Data: string; Charset: 'UTF-8' };
        Text: { Data: string; Charset: 'UTF-8' };
      };
      Headers?: { Name: string; Value: string }[];
    };
  };
  ConfigurationSetName?: string;
}

interface SesSendResult {
  MessageId?: string;
}

interface SesSdk {
  SESv2Client: new (config: {
    region: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
  }) => SesClientLike;
  SendEmailCommand: new (input: SesSendInput) => SesSendCommandLike;
}

const loadSesSdk = async (): Promise<SesSdk> => {
  try {
    const module_ =
      (await import('@aws-sdk/client-sesv2')) as unknown as Partial<SesSdk>;
    if (!module_.SESv2Client || !module_.SendEmailCommand) {
      throw new MailerNotConfigured(
        '@aws-sdk/client-sesv2 is missing required exports -- check the installed version.',
      );
    }
    return {
      SESv2Client: module_.SESv2Client,
      SendEmailCommand: module_.SendEmailCommand,
    };
  } catch (error) {
    if (error instanceof MailerNotConfigured) throw error;
    throw new MailerNotConfigured(
      'Install `@aws-sdk/client-sesv2` to use the ses transport (`pnpm add -D @aws-sdk/client-sesv2`).',
    );
  }
};

const RETRYABLE_NAMES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailable',
  'InternalFailure',
  'RequestTimeout',
  'NetworkingError',
]);

export const createSesTransport = (
  options: SesTransportOptions,
): MailTransport => {
  let cached: SesClientLike | null = null;
  let sdk: SesSdk | null = null;

  const getClient = async (): Promise<{
    client: SesClientLike;
    sdk: SesSdk;
  }> => {
    if (!sdk) sdk = await loadSesSdk();
    if (!cached) {
      cached = new sdk.SESv2Client({
        region: options.region,
        ...(options.accessKeyId && options.secretAccessKey
          ? {
              credentials: {
                accessKeyId: options.accessKeyId,
                secretAccessKey: options.secretAccessKey,
              },
            }
          : {}),
      });
    }
    return { client: cached, sdk };
  };

  return {
    name: 'ses',
    async send(message: MailMessage, opts: SendOptions): Promise<SendResult> {
      try {
        const { client, sdk: ses } = await getClient();
        const command = new ses.SendEmailCommand({
          FromEmailAddress: message.fromName
            ? `${message.fromName} <${message.from}>`
            : message.from,
          Destination: {
            ToAddresses: [message.to],
            ...(message.cc ? { CcAddresses: [...message.cc] } : {}),
            ...(message.bcc ? { BccAddresses: [...message.bcc] } : {}),
          },
          ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: message.html, Charset: 'UTF-8' },
                Text: { Data: message.text, Charset: 'UTF-8' },
              },
              Headers: [
                { Name: 'X-Idempotency-Key', Value: opts.idempotencyKey },
                ...Object.entries(message.headers ?? {}).map(
                  ([Name, Value]) => ({
                    Name,
                    Value,
                  }),
                ),
              ],
            },
          },
        });
        const result = await client.send(command);
        if (!result.MessageId) {
          return {
            ok: false,
            retryable: true,
            code: 'SES_EMPTY_MESSAGE_ID',
            message: 'SES returned no MessageId',
          };
        }
        return { ok: true, providerMessageId: result.MessageId };
      } catch (error) {
        const meta = error as {
          name?: string;
          message?: string;
          $metadata?: { httpStatusCode?: number };
        } | null;
        const status = meta?.$metadata?.httpStatusCode;
        const retryable =
          (status !== undefined && status >= 500 && status < 600) ||
          status === 429 ||
          RETRYABLE_NAMES.has(meta?.name ?? '');
        return {
          ok: false,
          retryable,
          code: meta?.name ?? 'SES_SEND_FAILED',
          message: meta?.message ?? 'SES send failed',
        };
      }
    },
    /**
     * SNS webhook normalisation. The actual signature verification
     * (RSA over the AWS-published cert) happens in the webhook handler
     * because it requires an outbound HTTP fetch -- doing it inside
     * `verifyWebhook` would block the worker. The handler stores the
     * raw event after sig verification; this method runs on
     * the worker side to parse it.
     */
    verifyWebhook(input: WebhookVerifyInput): readonly MailEvent[] | null {
      let envelope: SnsEnvelope;
      try {
        envelope = JSON.parse(input.rawBody.toString('utf8')) as SnsEnvelope;
      } catch {
        return null;
      }
      if (
        options.snsTopicArn &&
        envelope.TopicArn &&
        envelope.TopicArn !== options.snsTopicArn
      ) {
        return null;
      }
      if (envelope.Type === 'SubscriptionConfirmation') {
        // Confirmation requests carry no events -- the handler must
        // GET `SubscribeURL` separately. We return `[]` to indicate
        // "valid request, no events".
        return [];
      }
      if (envelope.Type !== 'Notification' || !envelope.Message) return null;
      let inner: SesEventPayload;
      try {
        inner = JSON.parse(envelope.Message) as SesEventPayload;
      } catch {
        return null;
      }
      const event = mapSesEvent(inner, envelope.MessageId);
      return event ? [event] : [];
    },
  };
};

interface SnsEnvelope {
  Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn?: string;
  Message?: string;
  SubscribeURL?: string;
}

interface SesEventPayload {
  eventType: string;
  mail: { messageId: string; timestamp: string; destination: string[] };
  bounce?: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined';
    bouncedRecipients: { emailAddress: string; diagnosticCode?: string }[];
  };
  complaint?: { complainedRecipients: { emailAddress: string }[] };
  delivery?: { recipients: string[] };
  open?: { timestamp: string };
  click?: { timestamp: string; link: string };
}

const mapSesEvent = (
  payload: SesEventPayload,
  envelopeId: string,
): MailEvent | null => {
  const occurredAt = new Date(payload.mail.timestamp);
  const messageId = payload.mail.messageId;
  const eventId = `ses-${envelopeId}`;
  const recipientFallback = payload.mail.destination[0] ?? '';

  let mappedType: MailEventType | null = null;
  let recipient = recipientFallback;
  let reason: string | undefined;

  if (payload.eventType === 'Bounce' && payload.bounce) {
    mappedType =
      payload.bounce.bounceType === 'Permanent'
        ? 'bounced.hard'
        : 'bounced.soft';
    recipient =
      payload.bounce.bouncedRecipients[0]?.emailAddress ?? recipientFallback;
    reason = payload.bounce.bouncedRecipients[0]?.diagnosticCode;
  } else if (payload.eventType === 'Complaint' && payload.complaint) {
    mappedType = 'complained';
    recipient =
      payload.complaint.complainedRecipients[0]?.emailAddress ??
      recipientFallback;
  } else if (payload.eventType === 'Delivery' && payload.delivery) {
    mappedType = 'delivered';
    recipient = payload.delivery.recipients[0] ?? recipientFallback;
  } else if (payload.eventType === 'Open') {
    mappedType = 'opened';
  } else if (payload.eventType === 'Click') {
    mappedType = 'clicked';
  }
  if (!mappedType) return null;

  return {
    type: mappedType,
    providerMessageId: messageId,
    providerEventId: eventId,
    occurredAt,
    recipient,
    reason,
  };
};
