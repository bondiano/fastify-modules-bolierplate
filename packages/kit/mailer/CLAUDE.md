# @kit/mailer

Outbox-backed transactional mail subsystem. Owns:

- a single `mailerService.send('<template>', payload, opts)` API for
  every kit-issued email (password reset, OTP, tenant invitation,
  email verification, welcome) and consumer-shipped templates;
- the `mail_deliveries` table that doubles as a durable outbox
  (Postgres = source of truth, BullMQ = async dispatch transport);
- 5 transport adapters (`smtp`, `ses`, `resend`, `postmark`,
  `dev-memory`) selected at startup via `MAILER_PROVIDER`;
- MJML templates compiled at build to static HTML, with
  Handlebars-style `{{var}}` interpolation that HTML-escapes by default;
- per-provider webhook receivers + a `mail_events` ledger that
  feeds bounce / complaint events into a tenant-scoped suppression
  list before the next send.

## Directory

```
src/
  index.ts                              barrel; imports `templates/seed.js` for side-effect registration
  schema.ts                             MailDeliveriesTable + MailEventsTable + MailSuppressionsTable + MailerDB
  config.ts                             mailerConfigSchema (Zod fragment)
  errors.ts                             MailerError hierarchy + retry-vs-fatal exception classes
  templates/
    _helpers.ts                         KitMailMessage + escape/format utilities (moved from @kit/auth)
    registry.ts                         MailTemplates global augmentation + defineTemplate registry
    render.ts                           load compiled HTML/text + Handlebars interpolation
    seed.ts                             registers the 5 kit-shipped templates with the registry
  transports/
    types.ts                            MailTransport + SendResult + MailEvent types
    smtp.ts | ses.ts | resend.ts | postmark.ts | dev-memory.ts
    index.ts                            createTransport(config) factory
  webhooks/
    index.ts                            verifyAndExtractEvents(transport, input)
  mail-deliveries-repository.ts         tenant-scoped reads + system-level enqueue / status mutators
  mail-events-repository.ts             webhook event ledger (idempotent ingestion)
  mail-suppressions-repository.ts       tenant-scoped reads + isSuppressed(email) (Redis cached)
  mailer-service.ts                     send / sendRaw / dispatch (outbox + worker entry points)
  provider.ts                           mailerProvider() Awilix registration

tools/
  compile-mjml.ts                       build CLI: templates/*.mjml -> dist/templates/compiled/

templates/                              source MJML + .txt fallback per template (5 sets)

migrations/
  20260512000001_create_mail_deliveries.ts
  20260512000002_create_mail_events.ts
  20260512000003_create_mail_suppressions.ts
  20260512000004_add_mail_from_to_tenants.ts
```

## Key ideas

- **Outbox = `mail_deliveries`.** The route handler / event callback
  inserts a row (`status='queued'`) right after the originating tx
  commits, then enqueues a BullMQ `mail.send` job carrying the row id.
  `idempotency_key UNIQUE` + ON CONFLICT DO UPDATE makes
  `mailerService.send(...)` safe to retry. If the BullMQ enqueue itself
  fails, the row stays at `'queued'` and the every-60s `mail.sweep`
  re-enqueues it. **Postgres is the source of truth for delivery
  state.** Redis is the dispatch transport.

- **Idempotent enqueue.** Callers pass an explicit `idempotencyKey`
  (a business-meaningful key like `password-reset:${userId}:${expiresAt}`).
  The kit uses it as both the `mail_deliveries.idempotency_key` UNIQUE
  constraint AND the BullMQ `jobId`, so two layers of dedup absorb
  retries from the originating service.

- **Retryable vs fatal.** Each transport returns a discriminated
  `SendResult`: `{ ok: true, providerMessageId }` on success,
  `{ ok: false, retryable, code, message }` otherwise. The worker
  uses `retryable` to decide whether to throw (-> BullMQ exponential
  backoff over 6 attempts) or mark the row `'failed'` immediately.
  Network errors / 5xx / throttle = retryable; auth failures /
  malformed recipients / suppression hits = fatal.

- **Suppression is enforced AT SEND, not at enqueue.** The worker
  checks `mailSuppressionsRepository.isSuppressed(email, tenantId)`
  inside the active tenant frame just before calling the transport.
  A complaint webhook landing between enqueue and send takes effect
  on the very next attempt.

- **MJML at build, Handlebars at runtime.** `pnpm --filter @kit/mailer
build:templates` produces static `dist/templates/compiled/*.html`
  files. `renderTemplate(...)` reads them at runtime and runs
  Handlebars-style `{{var}}` interpolation with **HTML-escape on by
  default**. Triple-stash `{{{raw}}}` is intentionally unsupported --
  raw HTML interpolation in a mail template is a phishing footgun;
  consumers needing pre-rendered HTML use `mailerService.sendRaw(...)`
  instead.

- **Plain-text is hand-written.** Every `<name>.mjml` ships a sibling
  `<name>.txt` containing the same body in plain text. Auto-derived
  plain-text from HTML routinely produces broken URLs and orphaned
  button labels; RFC 8058 / Gmail spam scoring care about the
  `text/plain` alternative being meaningful.

## Wiring (in services/api)

```ts
import {
  createDevMemoryTransport,
  createTransport,
  mailerProvider,
} from '@kit/mailer';
import {
  createMailDeliveriesRepository,
  createMailEventsRepository,
  createMailSuppressionsRepository,
} from '#modules/mailer/...';

const mailTransport = createTransport(config);

const container = await createContainer({
  // ...
  providers: [
    dbProvider(),
    authProvider({ /* see @kit/auth */ }),
    mailerProvider({
      resolveTransport: () => mailTransport,
      resolveDeliveriesRepository: ({ transaction, tenantContext }) =>
        createMailDeliveriesRepository({ transaction, tenantContext }),
      resolveEventsRepository: ({ transaction }) =>
        createMailEventsRepository({ transaction }),
      resolveSuppressionsRepository: ({ transaction, tenantContext, redis }) =>
        createMailSuppressionsRepository({ transaction, tenantContext, redis }),
      resolveDispatchJob: ({ queues }) => async (deliveryId, idempotencyKey) => {
        await queues.mail.add('mail.send', { deliveryId }, { jobId: idempotencyKey });
      },
      resolveDefaultFrom: () => ({
        from: config.MAIL_FROM,
        ...(config.MAIL_FROM_NAME ? { fromName: config.MAIL_FROM_NAME } : {}),
      }),
      resolveTenantFromOverride: () => async () => null,
    }),
  ],
});
```

## Adding a new template

1. Drop `<name>.mjml` + `<name>.txt` into `packages/kit/mailer/templates/`.
2. Augment `MailTemplates` and call `defineTemplate(...)` somewhere
   that's imported at module-load time (the kit's `templates/seed.ts`
   for kit-side templates; the consumer service's own
   `modules/mailer/seed.ts` for consumer-side templates):

   ```ts
   declare global {
     interface MailTemplates {
       'invoice-receipt': {
         readonly invoiceNumber: string;
         readonly amountCents: number;
         readonly downloadUrl: string;
       };
     }
   }

   defineTemplate('invoice-receipt', {
     subject: 'Receipt #{{invoiceNumber}}',
     tags: ['transactional', 'billing'],
     previewFixture: {
       to: 'preview@example.com',
       payload: { invoiceNumber: 'INV-1', amountCents: 4200, downloadUrl: 'https://x' },
     },
   });
   ```

3. Run `pnpm --filter @kit/mailer build:templates` to compile.
4. Consumers can now call:
   ```ts
   await mailerService.send(
     'invoice-receipt',
     { invoiceNumber: invoice.id, amountCents: invoice.total, downloadUrl: invoice.url },
     { idempotencyKey: `invoice:${invoice.id}`, to: customer.email, tenantId: customer.tenantId },
   );
   ```

## Adding a new transport

Implement `MailTransport` from `transports/types.ts`:

```ts
export const createMyTransport = (opts: MyOptions): MailTransport => ({
  name: 'my-transport',
  async send(message, opts) { /* return SendResult */ },
  verifyWebhook?(input) { /* return MailEvent[] | null */ },
});
```

Wire it into `createTransport(config)` (the kit's branch list). Adding
a vendor SDK as an optional peer-dep keeps the install lean for
consumers using a different provider.

## Webhooks

Each provider gets a route at `POST /webhooks/mail/{ses,postmark,resend}`
in `services/api/src/modules/mailer/webhooks.route.ts`. The route is
public (`withTenantBypass()`) but rate-limited and signature-verified.
The receiver:

1. Captures the raw body (a per-route `application/json` content-type
   parser stashes the buffer before JSON.parse).
2. Calls `transport.verifyWebhook({ headers, rawBody })` to verify the
   signature + extract normalized `MailEvent[]`.
3. Persists each event in `mail_events` (idempotent on
   `(provider, event_id)` UNIQUE).
4. ACKs 200 immediately; `mail.process-event` runs async to update
   `mail_deliveries.status` + populate `mail_suppressions` for hard
   bounces and complaints.

## Suppression list

- Tenant-scoped: each tenant has its own do-not-send list.
- Permanent for `hard_bounce` + `complaint` rows (CAN-SPAM §5(a)(4)
  requires opt-out honored indefinitely).
- TTL'd `manual` rows allow temporary blocks (e.g. during incident
  response).
- Pre-send lookup goes through Redis `SISMEMBER` cache keyed per
  tenant, falls back to the DB on miss + warms the cache for 1h.
- Webhook handlers populate the table automatically.

## Retention

`mail_deliveries` rows live forever in v1. Consumers can ship a
`mail.prune` cron analogous to `audit.prune` if storage becomes
relevant; the seek index `idx_mail_deliveries_pending` makes the
sweep cheap.

## Per-tenant `from` (Phase 3)

`tenants.mail_from` + `tenants.mail_from_name` + `tenants.mail_from_verified_at`
columns ship now (see migration `20260512000004`). Until DKIM
verification lands in Phase 3, the kit always falls back to
`config.MAIL_FROM` and uses the tenant's address as `Reply-To`. Wire a
real resolver into `resolveTenantFromOverride` once the verification
flow is built.

## Gotchas

- **Tenant frame inside workers.** Routes have a tenant frame from the
  `@kit/tenancy` plugin; jobs don't. The `mail.send` worker opens
  `tenantContext.withTenant(delivery.tenantId, ...)` itself before any
  tenant-scoped repository call (suppression lookup, audit emission).
  Forgetting this would cause `TenantNotResolved` from the suppression
  lookup.
- **Idempotency key choice.** Pick something that survives template
  edits. `password-reset:${userId}:${expiresAt}` is good because the
  expiresAt rotates per request. Hash of `(template, to, payload)` is
  bad for OTPs (every code is different) but fine for "welcome".
- **Triple-stash.** Unsupported on purpose. Use `sendRaw(...)` for
  pre-rendered HTML.
- **Vendor SDK install.** Each provider's SDK is an optional peer-dep.
  `createTransport(...)` throws `MailerNotConfigured` with an "install X"
  hint at boot if the consumer picked a provider whose SDK isn't
  installed.
- **No "send test" in `/admin/mail/preview`.** Render-only by design --
  too easy to accidentally email a real customer from sample data.
- **Audit failures don't fail sends.** The worker emits an audit row
  AFTER the transport returns; the `auditLogRepository.append` call
  failing wouldn't roll back the send. Both surfaces are observable
  via `mail_deliveries.status`.

## Conventions

- `mail_deliveries` is append-only on the happy path; status-update
  methods on the repo (`markSent`, `markBounced`, ...) are the only
  legal mutators. Nothing else writes the row.
- Webhook receivers ALWAYS ACK 200 (even on signature failure) to
  avoid leaking validity to attackers.
- Provider-specific quirks (SES SNS confirmation, Postmark Basic Auth,
  Resend Svix HMAC) live inside the per-transport `verifyWebhook` so
  the receiver route stays provider-agnostic.
- Never call `transport.send(...)` directly from a route. Always go
  through `mailerService.send(...)` so deliveries get the outbox +
  retry + audit story for free.
