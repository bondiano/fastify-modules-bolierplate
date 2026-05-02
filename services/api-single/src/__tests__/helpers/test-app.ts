import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '#config.ts';
import type { DB } from '#db/schema.ts';
import { createServer } from '#server/create.ts';
import { createContainer } from '@kit/core/di';
import { createLogger } from '@kit/core/logger';
import { dbProvider } from '@kit/db/runtime';
import { createTransactionStorage } from '@kit/db/transaction';
import { createTestDataSource, migrateToLatest } from '@kit/test/database';
import type { TestApp } from '@kit/test/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsPath = path.join(__dirname, '../../../migrations');

export const createTestApp = async (): Promise<TestApp<DB>> => {
  const logger = createLogger({ name: 'test', level: 'silent' });
  const dataSource = await createTestDataSource<DB>();
  const transactionStorage = await createTransactionStorage<DB>();

  await migrateToLatest(dataSource, migrationsPath);

  const container = await createContainer({
    logger,
    config,
    extraValues: {
      dataSource,
      transactionStorage,
    },
    modulesGlobs: [
      `${__dirname}/../../modules/**/*.{repository,service,mapper,client}.{js,ts}`,
    ],
    providers: [dbProvider()],
  });

  const server = await createServer({
    config,
    container,
    logger,
    security: { rateLimit: false },
  });

  return { server, dataSource };
};
