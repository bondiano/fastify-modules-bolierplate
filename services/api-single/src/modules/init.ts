import type { Cradle as _Cradle } from '@fastify/awilix';
import type { Kysely } from 'kysely';

import type { DB } from '#db/schema.ts';
import type { Trx, TransactionStorage } from '@kit/db/transaction';

declare global {
  interface Dependencies {
    dataSource: Kysely<DB>;
    transactionStorage: TransactionStorage<DB>;
    transaction: Trx<DB>;
  }
}

declare module '@fastify/awilix' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Cradle extends Dependencies {}
}
