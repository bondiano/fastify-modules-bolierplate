import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // FK -> tenants.id ON DELETE SET NULL: a hard tenant DELETE preserves the
    // audit trail (rare in practice -- tenants are soft-deleted -- but matters
    // for cleanup jobs and forensic recovery). Nullable so pre-tenant flows
    // (signup, password reset) can still emit entries.
    .addColumn('tenant_id', 'uuid', (col) =>
      col.references('tenants.id').onDelete('set null'),
    )
    // FK -> users.id ON DELETE SET NULL for the same reason. NULL also
    // represents a system-initiated action (cron, CLI, webhook).
    .addColumn('actor_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('subject_type', 'text', (col) => col.notNull())
    // text not uuid -- subject ids may be slugs, composite keys, or external
    // ids (Stripe customer ids, etc.) once downstream packages start auditing.
    .addColumn('subject_id', 'text', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('diff', 'jsonb')
    .addColumn('metadata', 'jsonb')
    .addColumn('ip', 'text')
    .addColumn('user_agent', 'text')
    .addColumn('correlation_id', 'text')
    .addColumn('sensitive', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Admin pagination filter: list a tenant's audit log newest-first.
  await sql`
    CREATE INDEX idx_audit_log_tenant_created
      ON audit_log (tenant_id, created_at DESC)
  `.execute(db);

  // Actor drill-down ("show every action this user has taken"). Partial so
  // system-initiated rows (actor_id IS NULL) don't bloat the index.
  await sql`
    CREATE INDEX idx_audit_log_actor_created
      ON audit_log (actor_id, created_at DESC)
      WHERE actor_id IS NOT NULL
  `.execute(db);

  // Record-history drill-down ("show every action against this record").
  await sql`
    CREATE INDEX idx_audit_log_subject_created
      ON audit_log (subject_type, subject_id, created_at DESC)
  `.execute(db);

  // Seek index for the audit.prune job (P2.audit.6).
  await db.schema
    .createIndex('idx_audit_log_created_at')
    .on('audit_log')
    .column('created_at')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('audit_log').execute();
}
