/* eslint-disable no-console */
import path from 'node:path';

import { defineCommand, runMain } from 'citty';

import { createConfig, findWorkspaceRoot } from '@kit/config';
import {
  migrateToLatest,
  rollbackLast,
  createMigrationFile,
} from '@kit/db/cli';
import { dbConfigSchema } from '@kit/db/config';
import { createDataSource } from '@kit/db/runtime';

import type { DB } from './schema.ts';

const migrationFolder = path.join(import.meta.dirname, '../../migrations');

interface CLIContext {
  dataSource: ReturnType<typeof createDataSource<DB>>;
  migrationFolder: string;
  logger: typeof logger;
}

const withDataSource = async <T>(
  fn: (ctx: CLIContext) => Promise<T>,
): Promise<T> => {
  const config = createConfig(
    { ...dbConfigSchema },
    { envPath: findWorkspaceRoot(import.meta.dirname) },
  );

  const dataSource = createDataSource<DB>({
    logger,
    connectionString: config.DATABASE_URL,
  });

  try {
    return await fn({ dataSource, migrationFolder, logger });
  } finally {
    await dataSource.destroy();
  }
};

const logger = {
  info: (object: object, message?: string) =>
    console.log(message ?? '', object),
  error: (object: object, message?: string) =>
    console.error(message ?? '', object),
  debug: (...args: unknown[]) => console.debug(...args),
};

const migrate = defineCommand({
  meta: { name: 'migrate', description: 'Run all pending migrations' },
  async run() {
    await withDataSource(({ dataSource, migrationFolder, logger }) =>
      migrateToLatest({ dataSource, migrationFolder, logger }),
    );
  },
});

const rollback = defineCommand({
  meta: {
    name: 'rollback',
    description: 'Rollback the last applied migration',
  },
  async run() {
    await withDataSource(({ dataSource, migrationFolder, logger }) =>
      rollbackLast({ dataSource, migrationFolder, logger }),
    );
  },
});

const create = defineCommand({
  meta: { name: 'create', description: 'Scaffold a new migration file' },
  args: {
    name: {
      type: 'positional',
      required: true,
      description: 'Migration name (will be converted to snake_case)',
    },
  },
  async run({ args }) {
    const filePath = await createMigrationFile(migrationFolder, args.name);
    console.log(`Created migration: ${filePath}`);
  },
});

const main = defineCommand({
  meta: { name: 'db', description: 'Database migration CLI' },
  subCommands: { migrate, rollback, create },
});

await runMain(main);
