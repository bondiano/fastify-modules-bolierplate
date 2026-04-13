#!/usr/bin/env -S node

/* eslint-disable no-console */

import { parseArgs } from 'node:util';

import type { DB } from '#db/schema.ts';
import { authConfigSchema } from '@kit/auth/config';
import { createPasswordHasher } from '@kit/auth/password';
import { createConfig, findWorkspaceRoot } from '@kit/config';
import { createContainer } from '@kit/core/di';
import { createLogger } from '@kit/core/logger';
import { dbConfigSchema } from '@kit/db/config';
import { createDataSource, dbProvider } from '@kit/db/runtime';
import { createTransactionStorage } from '@kit/db/transaction';

const config = createConfig(
  { ...dbConfigSchema, ...authConfigSchema },
  { envPath: findWorkspaceRoot(import.meta.dirname) },
);

const logger = createLogger({
  name: 'create-admin',
  level: 'error',
  pretty: true,
});

const { values } = parseArgs({
  options: {
    email: { type: 'string', short: 'e' },
    password: { type: 'string', short: 'p' },
  },
  strict: true,
});

const email = values.email;
const password = values.password;

if (!email || !password) {
  console.error(
    'Usage: pnpm create-admin --email <email> --password <password>',
  );
  console.error('       pnpm create-admin -e <email> -p <password>');
  process.exit(1);
}

const dataSource = createDataSource<DB>({
  logger,
  connectionString: config.DATABASE_URL,
});

const transactionStorage = await createTransactionStorage();

const container = await createContainer({
  logger,
  config,
  extraValues: { dataSource, transactionStorage },
  modulesGlobs: [
    `${import.meta.dirname}/../modules/**/*.{repository,service,mapper,client}.{js,ts}`,
  ],
  providers: [dbProvider()],
});

const { usersRepository } = container.cradle as Dependencies;
const passwordHasher = createPasswordHasher();

const existing = await usersRepository.findByEmail(email);
if (existing) {
  console.error(`User with email "${email}" already exists.`);
  await dataSource.destroy();
  process.exit(1);
}

const passwordHash = await passwordHasher.hash(password);
const admin = await usersRepository.create({
  email,
  passwordHash,
  role: 'admin',
});

console.log(`Admin user created successfully:`);
console.log(`  ID:    ${admin.id}`);
console.log(`  Email: ${admin.email}`);
console.log(`  Role:  ${admin.role}`);

await dataSource.destroy();
