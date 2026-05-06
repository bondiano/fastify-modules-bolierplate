/**
 * Transport factory. Selects the active adapter based on
 * `config.MAILER_PROVIDER` and validates that the adapter's required
 * config is populated. Adapters lazy-load their vendor SDKs so a
 * service that uses Resend doesn't need `@aws-sdk/client-sesv2`
 * installed.
 */
import type { MailerConfig } from '../config.js';
import { MailerNotConfigured } from '../errors.js';

import { createDevMemoryTransport } from './dev-memory.js';
import { createPostmarkTransport } from './postmark.js';
import { createResendTransport } from './resend.js';
import { createSesTransport } from './ses.js';
import { createSmtpTransport } from './smtp.js';
import type { MailTransport } from './types.js';

export type { DevMemoryTransport, DevMemoryEntry } from './dev-memory.js';
export type {
  MailEvent,
  MailEventType,
  MailTransport,
  SendOptions,
  SendResult,
  TransportName,
  WebhookVerifyInput,
} from './types.js';

/**
 * Returns the active transport for a given config. Throws
 * `MailerNotConfigured` synchronously when required env vars are
 * missing -- the consumer should call this once at startup so a
 * misconfiguration surfaces at boot rather than on the first send.
 */
export const createTransport = (
  config: Pick<
    MailerConfig,
    | 'MAILER_PROVIDER'
    | 'SMTP_HOST'
    | 'SMTP_PORT'
    | 'SMTP_USER'
    | 'SMTP_PASSWORD'
    | 'SMTP_SECURE'
    | 'AWS_SES_REGION'
    | 'AWS_SES_ACCESS_KEY_ID'
    | 'AWS_SES_SECRET_ACCESS_KEY'
    | 'AWS_SNS_TOPIC_ARN'
    | 'RESEND_API_KEY'
    | 'RESEND_WEBHOOK_SECRET'
    | 'POSTMARK_SERVER_TOKEN'
    | 'POSTMARK_WEBHOOK_USER'
    | 'POSTMARK_WEBHOOK_PASSWORD'
  >,
): MailTransport => {
  switch (config.MAILER_PROVIDER) {
    case 'dev-memory': {
      return createDevMemoryTransport();
    }
    case 'smtp': {
      if (!config.SMTP_HOST || !config.SMTP_PORT) {
        throw new MailerNotConfigured(
          'MAILER_PROVIDER=smtp requires SMTP_HOST and SMTP_PORT.',
        );
      }
      return createSmtpTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        ...(config.SMTP_USER ? { user: config.SMTP_USER } : {}),
        ...(config.SMTP_PASSWORD ? { password: config.SMTP_PASSWORD } : {}),
      });
    }
    case 'ses': {
      if (!config.AWS_SES_REGION) {
        throw new MailerNotConfigured(
          'MAILER_PROVIDER=ses requires AWS_SES_REGION.',
        );
      }
      return createSesTransport({
        region: config.AWS_SES_REGION,
        ...(config.AWS_SES_ACCESS_KEY_ID
          ? { accessKeyId: config.AWS_SES_ACCESS_KEY_ID }
          : {}),
        ...(config.AWS_SES_SECRET_ACCESS_KEY
          ? { secretAccessKey: config.AWS_SES_SECRET_ACCESS_KEY }
          : {}),
        ...(config.AWS_SNS_TOPIC_ARN
          ? { snsTopicArn: config.AWS_SNS_TOPIC_ARN }
          : {}),
      });
    }
    case 'resend': {
      if (!config.RESEND_API_KEY) {
        throw new MailerNotConfigured(
          'MAILER_PROVIDER=resend requires RESEND_API_KEY.',
        );
      }
      return createResendTransport({
        apiKey: config.RESEND_API_KEY,
        ...(config.RESEND_WEBHOOK_SECRET
          ? { webhookSecret: config.RESEND_WEBHOOK_SECRET }
          : {}),
      });
    }
    case 'postmark': {
      if (!config.POSTMARK_SERVER_TOKEN) {
        throw new MailerNotConfigured(
          'MAILER_PROVIDER=postmark requires POSTMARK_SERVER_TOKEN.',
        );
      }
      return createPostmarkTransport({
        serverToken: config.POSTMARK_SERVER_TOKEN,
        ...(config.POSTMARK_WEBHOOK_USER
          ? { webhookUser: config.POSTMARK_WEBHOOK_USER }
          : {}),
        ...(config.POSTMARK_WEBHOOK_PASSWORD
          ? { webhookPassword: config.POSTMARK_WEBHOOK_PASSWORD }
          : {}),
      });
    }
  }
};

// Adapter re-exports so consumers who only need a single adapter can
// import from `@kit/mailer/transport` without pulling in the factory.
export { createDevMemoryTransport } from './dev-memory.js';
export { createPostmarkTransport } from './postmark.js';
export { createResendTransport } from './resend.js';
export { createSesTransport } from './ses.js';
export { createSmtpTransport } from './smtp.js';
