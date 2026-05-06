/**
 * In-process memory transport. Pushes every message onto a shared array
 * and resolves successfully. Used by tests AND by `MAILER_PROVIDER=dev-memory`
 * for local development without a real provider.
 *
 * The outbox is exposed as `transport.outbox` so tests can read sent
 * messages directly. Reset via `transport.reset()` between tests; the
 * `setupIntegrationTest` helper calls this in `beforeEach`.
 */
import { randomUUID } from 'node:crypto';

import type { MailMessage } from '../templates/_helpers.js';

import type { MailTransport, SendOptions, SendResult } from './types.js';

export interface DevMemoryEntry {
  readonly providerMessageId: string;
  readonly idempotencyKey: string;
  readonly message: MailMessage;
  readonly sentAt: Date;
}

export interface DevMemoryTransport extends MailTransport {
  readonly outbox: readonly DevMemoryEntry[];
  /** Drop every captured message. Tests call this in `beforeEach`. */
  reset(): void;
}

export const createDevMemoryTransport = (): DevMemoryTransport => {
  const captured: DevMemoryEntry[] = [];

  return {
    name: 'dev-memory',
    get outbox() {
      return captured;
    },
    reset(): void {
      captured.length = 0;
    },
    async send(message: MailMessage, opts: SendOptions): Promise<SendResult> {
      const providerMessageId = `dev-${randomUUID()}`;
      captured.push({
        providerMessageId,
        idempotencyKey: opts.idempotencyKey,
        message,
        sentAt: new Date(),
      });
      return { ok: true, providerMessageId };
    },
  };
};
