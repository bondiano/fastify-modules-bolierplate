/**
 * SMTP transport via nodemailer. nodemailer is an optional peer-dep --
 * the import is lazy so consumers who use a different provider don't
 * pay the install cost. Lazy via `await import(...)` because Node ESM
 * has no synchronous dynamic import.
 */
import { MailerNotConfigured } from '../errors.js';
import type { MailMessage } from '../templates/_helpers.js';

import type { MailTransport, SendOptions, SendResult } from './types.js';

export interface SmtpTransportOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string;
  readonly password?: string;
}

interface NodemailerLike {
  createTransport(opts: {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  }): NodemailerTransporterLike;
}

interface NodemailerTransporterLike {
  sendMail(message: NodemailerMessage): Promise<{ messageId: string }>;
}

interface NodemailerMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  cc?: readonly string[];
  bcc?: readonly string[];
  headers?: Readonly<Record<string, string>>;
  messageId?: string;
}

const loadNodemailer = async (): Promise<NodemailerLike> => {
  try {
    const module_ = (await import('nodemailer')) as unknown as
      | { default?: NodemailerLike }
      | NodemailerLike;
    return 'createTransport' in (module_ as NodemailerLike)
      ? (module_ as NodemailerLike)
      : ((module_ as { default?: NodemailerLike }).default as NodemailerLike);
  } catch {
    throw new MailerNotConfigured(
      'Install `nodemailer` to use the smtp transport (`pnpm add -D nodemailer @types/nodemailer`).',
    );
  }
};

const isRetryable = (error: unknown): boolean => {
  // nodemailer wraps the underlying error; `responseCode` is the SMTP
  // response when present. 4xx SMTP codes are retryable per RFC 5321.
  const meta = error as { responseCode?: number; code?: string } | null;
  if (!meta) return true;
  if (typeof meta.responseCode === 'number') {
    return meta.responseCode >= 400 && meta.responseCode < 500;
  }
  // Network / DNS / timeout codes
  if (
    meta.code === 'ECONNECTION' ||
    meta.code === 'ETIMEDOUT' ||
    meta.code === 'ECONNRESET'
  ) {
    return true;
  }
  return false;
};

export const createSmtpTransport = (
  options: SmtpTransportOptions,
): MailTransport => {
  let cachedTransporter: NodemailerTransporterLike | null = null;

  const getTransporter = async (): Promise<NodemailerTransporterLike> => {
    if (cachedTransporter) return cachedTransporter;
    const nodemailer = await loadNodemailer();
    cachedTransporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user && options.password
        ? { auth: { user: options.user, pass: options.password } }
        : {}),
    });
    return cachedTransporter;
  };

  return {
    name: 'smtp',
    async send(message: MailMessage, opts: SendOptions): Promise<SendResult> {
      try {
        const transporter = await getTransporter();
        const sent = await transporter.sendMail({
          from: message.fromName
            ? `${message.fromName} <${message.from}>`
            : message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          ...(message.cc ? { cc: message.cc } : {}),
          ...(message.bcc ? { bcc: message.bcc } : {}),
          ...(message.headers ? { headers: message.headers } : {}),
          // RFC 5322 Message-ID; deterministic so the same idempotency
          // key sent twice produces the same MIME header (most SMTP
          // gateways dedupe on this).
          messageId: `<${opts.idempotencyKey}@${options.host}>`,
        });
        return { ok: true, providerMessageId: sent.messageId };
      } catch (error) {
        const meta = error as { code?: string; message?: string } | null;
        return {
          ok: false,
          retryable: isRetryable(error),
          code: meta?.code ?? 'SMTP_SEND_FAILED',
          message: meta?.message ?? 'SMTP send failed',
        };
      }
    },
    // SMTP has no built-in webhook; delivery / bounce notifications come
    // through provider-specific channels (e.g. an inbox parser). Out of
    // scope for the kit -- the consumer wires their own.
  };
};
