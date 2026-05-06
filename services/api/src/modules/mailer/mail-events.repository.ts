import type { DB } from '#db/schema.ts';
import type { Trx } from '@kit/db/transaction';
import {
  createMailEventsRepository as factory,
  type MailEventsRepository as KitMailEventsRepository,
} from '@kit/mailer';

interface MailEventsRepositoryDeps {
  transaction: Trx<DB>;
}

export const createMailEventsRepository = ({
  transaction,
}: MailEventsRepositoryDeps): KitMailEventsRepository =>
  factory<DB>({ transaction });

export type MailEventsRepository = ReturnType<
  typeof createMailEventsRepository
>;
