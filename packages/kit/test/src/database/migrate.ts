import fs from 'node:fs/promises';
import path from 'node:path';

import { FileMigrationProvider, Migrator } from 'kysely';
import type { Kysely } from 'kysely';

/**
 * Runs all pending migrations against a PGlite-backed Kysely instance.
 *
 * Uses Kysely's built-in `FileMigrationProvider` with dynamic imports
 * which is more compatible across test runners than `kysely-pglite`'s
 * globby-based migrator.
 *
 * @param dataSource - Kysely instance (typically from createTestDataSource)
 * @param migrationsPath - Absolute path to the migrations directory
 */
export const migrateToLatest = async <DB>(
  dataSource: Kysely<DB>,
  migrationsPath: string,
): Promise<void> => {
  const migrator = new Migrator({
    db: dataSource,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: migrationsPath,
    }),
  });

  const { error } = await migrator.migrateToLatest();

  if (error) {
    throw error;
  }
};
