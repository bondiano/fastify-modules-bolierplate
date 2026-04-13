import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  FileMigrationProvider,
  Migrator,
  type Kysely,
  type MigrationResultSet,
} from 'kysely';

export interface CreateMigratorOptions<DB> {
  dataSource: Kysely<DB>;
  /** Absolute path to the directory holding migration files. */
  migrationFolder: string;
}

export function createMigrator<DB>({
  dataSource,
  migrationFolder,
}: CreateMigratorOptions<DB>): Migrator {
  return new Migrator({
    db: dataSource,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
    }),
  });
}

const reportResults = (
  results: MigrationResultSet,
  logger: {
    info: (object: object, message?: string) => void;
    error: (object: object, message?: string) => void;
  },
): void => {
  const { error, results: migrations = [] } = results;
  for (const migration of migrations) {
    if (migration.status === 'Success') {
      logger.info(
        { migration: migration.migrationName, direction: migration.direction },
        'Migration applied',
      );
    } else if (migration.status === 'Error') {
      logger.error({ migration: migration.migrationName }, 'Migration failed');
    }
  }
  if (error) {
    throw error;
  }
};

export async function migrateToLatest<DB>(
  options: CreateMigratorOptions<DB> & {
    logger?: {
      info: (object: object, message?: string) => void;
      error: (object: object, message?: string) => void;
    };
  },
): Promise<void> {
  const migrator = createMigrator(options);
  const results = await migrator.migrateToLatest();
  reportResults(results, options.logger ?? console);
}

export async function rollbackLast<DB>(
  options: CreateMigratorOptions<DB> & {
    logger?: {
      info: (object: object, message?: string) => void;
      error: (object: object, message?: string) => void;
    };
  },
): Promise<void> {
  const migrator = createMigrator(options);
  const results = await migrator.migrateDown();
  reportResults(results, options.logger ?? console);
}

/**
 * Scaffolds an empty timestamped migration file and returns its path.
 * The name is sanitized to snake_case.
 */
export async function createMigrationFile(
  migrationFolder: string,
  name: string,
): Promise<string> {
  const safeName = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
  if (!safeName) {
    throw new Error(
      'Migration name must contain at least one alphanumeric character',
    );
  }

  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:TZ.]/g, '')
    .slice(0, 14);
  const filename = `${timestamp}_${safeName}.ts`;
  const filePath = path.join(migrationFolder, filename);

  await fs.mkdir(migrationFolder, { recursive: true });
  await fs.writeFile(
    filePath,
    `import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // TODO: describe the "up" migration
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // TODO: describe the "down" migration
}
`,
    'utf8',
  );

  return filePath;
}
