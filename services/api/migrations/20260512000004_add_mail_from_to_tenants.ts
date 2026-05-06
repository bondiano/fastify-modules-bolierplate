import type { Kysely } from 'kysely';

/**
 * Adds the per-tenant `from` override columns. Until a tenant has a
 * `mail_from_verified_at` set (Phase 3 ships the DKIM verification
 * flow), the mailer uses `config.MAIL_FROM` and sets `Reply-To` to the
 * tenant's `mail_from` so replies still route correctly.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('tenants')
    .addColumn('mail_from', 'text')
    .addColumn('mail_from_name', 'text')
    .addColumn('mail_from_verified_at', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('tenants')
    .dropColumn('mail_from')
    .dropColumn('mail_from_name')
    .dropColumn('mail_from_verified_at')
    .execute();
}
