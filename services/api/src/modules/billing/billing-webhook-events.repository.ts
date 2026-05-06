import type { DB } from '#db/schema.ts';
import {
  createBillingWebhookEventsRepository as factory,
  type BillingWebhookEventsRepository as KitRepository,
} from '@kit/billing';
import type { Trx } from '@kit/db/transaction';

interface RepoDeps {
  transaction: Trx<DB>;
}

export const createBillingWebhookEventsRepository = ({
  transaction,
}: RepoDeps): KitRepository => factory<DB>({ transaction });

export type BillingWebhookEventsRepository = ReturnType<
  typeof createBillingWebhookEventsRepository
>;
