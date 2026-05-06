/**
 * Mailer module-level types. The kit-side `@kit/mailer/provider`
 * declares the cradle additions for `mailDeliveriesRepository` /
 * `mailEventsRepository` / `mailSuppressionsRepository` /
 * `mailTransport` / `mailerService` typed against `MailerDB`. The
 * consumer factories in `mail-*.repository.ts` build the same shape
 * over the service's narrower `DB` (which extends `MailerDB`), so the
 * cradle types match without redeclaration.
 *
 * Kept as a stub for parity with other modules' `*.module.ts` files
 * and so future service-only Dependencies (custom mail event
 * subscribers, per-tenant mailer overrides, etc) have a place to land.
 */
