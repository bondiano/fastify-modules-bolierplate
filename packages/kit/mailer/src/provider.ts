/**
 * Awilix DI registration for `@kit/mailer`. Mirrors `@kit/auth`'s
 * provider shape: every infrastructure dependency comes through a
 * resolver callback so this package stays free of ORM / Redis / BullMQ
 * coupling and doesn't try to declare `transaction` / `tenantContext`
 * shapes that the consuming service owns.
 *
 * After `mailerProvider({...})(container)` runs, the cradle exposes:
 *   - `mailDeliveriesRepository`
 *   - `mailEventsRepository`
 *   - `mailSuppressionsRepository`
 *   - `mailTransport`
 *   - `mailerService`
 *
 * The consumer typically wires `services/api/src/bin/server.ts`:
 *
 * ```ts
 * mailerProvider({
 *   resolveTransport: () => createTransport(config),
 *   resolveDeliveriesRepository: ({ transaction, tenantContext }) =>
 *     createMailDeliveriesRepository({ transaction, tenantContext }),
 *   resolveEventsRepository: ({ transaction }) =>
 *     createMailEventsRepository({ transaction }),
 *   resolveSuppressionsRepository: ({ transaction, tenantContext, redis }) =>
 *     createMailSuppressionsRepository({ transaction, tenantContext, cache: redis }),
 *   resolveDispatchJob: ({ queues }) => (id, key) =>
 *     queues.mail.add('mail.send', { deliveryId: id }, { jobId: key }),
 *   resolveDefaultFrom: ({ config }) => ({
 *     from: config.MAIL_FROM,
 *     fromName: config.MAIL_FROM_NAME,
 *   }),
 * });
 * ```
 */
import { asFunction, Lifetime } from 'awilix';

import type { ContainerProvider } from '@kit/core/di';

import type { MailDeliveriesRepository } from './mail-deliveries-repository.js';
import type { MailEventsRepository } from './mail-events-repository.js';
import type { MailSuppressionsRepository } from './mail-suppressions-repository.js';
import { createMailerService, type MailerService } from './mailer-service.js';
import type { MailerDB } from './schema.js';
import type { MailTransport } from './transports/types.js';

declare global {
  interface Dependencies {
    mailDeliveriesRepository: MailDeliveriesRepository<MailerDB>;
    mailEventsRepository: MailEventsRepository;
    mailSuppressionsRepository: MailSuppressionsRepository<MailerDB>;
    mailTransport: MailTransport;
    mailerService: MailerService;
  }
}

export interface MailerProviderOptions {
  resolveTransport: (deps: Dependencies) => MailTransport;
  resolveDeliveriesRepository: (
    deps: Dependencies,
  ) => MailDeliveriesRepository<MailerDB>;
  resolveEventsRepository: (deps: Dependencies) => MailEventsRepository;
  resolveSuppressionsRepository: (
    deps: Dependencies,
  ) => MailSuppressionsRepository<MailerDB>;
  /** BullMQ enqueue callback. Wired by the consumer to
   * `(id, key) => fastify.queues.mail.add('mail.send', { deliveryId: id }, { jobId: key })`. */
  resolveDispatchJob: (
    deps: Dependencies,
  ) => (deliveryId: string, idempotencyKey: string) => Promise<void>;
  /** Returns the platform `from` address + display name. Read from
   * `config.MAIL_FROM` / `config.MAIL_FROM_NAME` typically. */
  resolveDefaultFrom: (deps: Dependencies) => {
    from: string;
    fromName?: string;
  };
  /** Optional: per-tenant `from` override resolver. Returns `null`
   * when the tenant has no verified override (or when DKIM
   * verification hasn't shipped). */
  resolveTenantFromOverride?: (
    deps: Dependencies,
  ) => (
    tenantId: string,
  ) => Promise<{ from: string; fromName?: string } | null>;
}

export const mailerProvider =
  (options: MailerProviderOptions): ContainerProvider =>
  (container) => {
    container.register({
      mailTransport: asFunction(options.resolveTransport, {
        lifetime: Lifetime.SINGLETON,
      }),
      mailDeliveriesRepository: asFunction(
        options.resolveDeliveriesRepository,
        { lifetime: Lifetime.SINGLETON },
      ),
      mailEventsRepository: asFunction(options.resolveEventsRepository, {
        lifetime: Lifetime.SINGLETON,
      }),
      mailSuppressionsRepository: asFunction(
        options.resolveSuppressionsRepository,
        { lifetime: Lifetime.SINGLETON },
      ),
      mailerService: asFunction(
        (deps: Dependencies) => {
          const defaults = options.resolveDefaultFrom(deps);
          const tenantFromResolver = options.resolveTenantFromOverride?.(deps);
          return createMailerService({
            mailDeliveriesRepository: deps.mailDeliveriesRepository,
            transport: deps.mailTransport,
            defaultFrom: defaults.from,
            ...(defaults.fromName
              ? { defaultFromName: defaults.fromName }
              : {}),
            dispatchJob: options.resolveDispatchJob(deps),
            ...(tenantFromResolver
              ? { resolveTenantFrom: tenantFromResolver }
              : {}),
          });
        },
        { lifetime: Lifetime.SINGLETON },
      ),
    });
  };
