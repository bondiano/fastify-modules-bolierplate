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
import { createTenantContext, createTenantStorage } from '@kit/tenancy';

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
const tenantStorage = createTenantStorage();
const tenantContext = createTenantContext({ tenantStorage });

const container = await createContainer({
  logger,
  config,
  extraValues: { dataSource, transactionStorage, tenantStorage, tenantContext },
  modulesGlobs: [
    `${import.meta.dirname}/../modules/**/*.{repository,service,mapper,client}.{js,ts}`,
  ],
  providers: [dbProvider()],
});

const { usersRepository, tenantsService, transaction } =
  container.cradle as Dependencies;
const passwordHasher = createPasswordHasher();

const existing = await usersRepository.findByEmail(email);
if (existing) {
  console.error(`User with email "${email}" already exists.`);
  await dataSource.destroy();
  process.exit(1);
}

const passwordHash = await passwordHasher.hash(password);

// Mirror the registration flow: every new account gets a personal
// tenant + an `owner` membership in the same transaction.
const admin = await transaction(async () => {
  const tenant = await tenantsService.create({ name: email });
  const user = await transaction
    .insertInto('users')
    .values({
      email,
      passwordHash,
      role: 'admin',
      tenantId: tenant.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await transaction
    .insertInto('memberships')
    .values({
      tenantId: tenant.id,
      userId: user.id,
      role: 'owner',
      joinedAt: new Date().toISOString(),
    })
    .execute();
  return { user, tenant };
});

console.log(`Admin user created successfully:`);
console.log(`  ID:       ${admin.user.id}`);
console.log(`  Email:    ${admin.user.email}`);
console.log(`  Role:     ${admin.user.role}`);
console.log(`  Tenant:   ${admin.tenant.name} (${admin.tenant.slug})`);

await dataSource.destroy();
