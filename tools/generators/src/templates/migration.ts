export const emptyMigrationTemplate =
  (): string => `import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // TODO: describe the "up" migration
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // TODO: describe the "down" migration
}
`;

export const createTableMigrationTemplate = (
  tableName: string,
): string => `import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('${tableName}')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql\`gen_random_uuid()\`),
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql\`now()\`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql\`now()\`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('${tableName}').execute();
}
`;

export const sanitizeMigrationName = (name: string): string => {
  const safe = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
  if (!safe) {
    throw new Error(
      'Migration name must contain at least one alphanumeric character',
    );
  }
  return safe;
};

export const migrationTimestamp = (now: Date = new Date()): string =>
  now
    .toISOString()
    .replaceAll(/[-:TZ.]/g, '')
    .slice(0, 14);
