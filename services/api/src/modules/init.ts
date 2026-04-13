import type { Cradle as _Cradle } from '@fastify/awilix';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';

import type { DB } from '#db/schema.ts';
import type { AbilityFactory, DefineAbilities } from '@kit/authz';
import type { Trx, TransactionStorage } from '@kit/db/transaction';

declare global {
  interface Dependencies {
    redis: Redis;
    dataSource: Kysely<DB>;
    transactionStorage: TransactionStorage<DB>;
    transaction: Trx<DB>;
    abilityDefiners: readonly DefineAbilities[];
    abilityFactory: AbilityFactory;
  }
}

declare module '@fastify/awilix' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Cradle extends Dependencies {}
}
