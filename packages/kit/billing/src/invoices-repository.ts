/**
 * Repository for the `invoices` table. Tenant-scoped reads + system-level
 * apply-event writes. Mirrors `subscriptions-repository.ts`.
 */
import type { Insertable, Selectable } from 'kysely';

import type { Trx } from '@kit/db/runtime';
import {
  createTenantScopedRepository,
  type TenantContext,
  type TenantScopedRepository,
} from '@kit/tenancy';

import type { NormalizedInvoice } from './events.js';
import type { BillingDB, InvoicesTable } from './schema.js';

export type InvoiceInsert = Insertable<InvoicesTable>;
export type InvoiceRow = Selectable<InvoicesTable>;

type ReadSurface<DB extends BillingDB> = Pick<
  TenantScopedRepository<DB, 'invoices'>,
  | 'table'
  | 'findById'
  | 'findByIdOrThrow'
  | 'findAll'
  | 'findPaginated'
  | 'findPaginatedByPage'
  | 'count'
>;

export interface InvoiceUpsertFromEventInput {
  readonly tenantId: string;
  readonly billingCustomerId: string;
  readonly subscriptionId: string | null;
  readonly invoice: NormalizedInvoice;
}

export interface InvoicesRepository<
  DB extends BillingDB,
> extends ReadSurface<DB> {
  upsertFromEvent(input: InvoiceUpsertFromEventInput): Promise<InvoiceRow>;

  findByProviderInvoiceId(
    providerInvoiceId: string,
  ): Promise<InvoiceRow | null>;

  /** Stuck-invoice reconciliation seek: rows in 'open' state older than
   * `now - olderThanMs`. Frame-less. */
  findStuckOpen(opts: {
    olderThanMs: number;
    limit: number;
  }): Promise<readonly InvoiceRow[]>;
}

export interface InvoicesRepositoryDeps<DB extends BillingDB> {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
}

export const createInvoicesRepository = <DB extends BillingDB>({
  transaction,
  tenantContext,
}: InvoicesRepositoryDeps<DB>): InvoicesRepository<DB> => {
  const scoped = createTenantScopedRepository<DB, 'invoices'>({
    transaction,
    tenantContext,
    tableName: 'invoices',
    tenantColumn: 'tenant_id',
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;

  return {
    table: scoped.table,
    findById: scoped.findById,
    findByIdOrThrow: scoped.findByIdOrThrow,
    findAll: scoped.findAll,
    findPaginated: scoped.findPaginated,
    findPaginatedByPage: scoped.findPaginatedByPage,
    count: scoped.count,

    async upsertFromEvent({
      tenantId,
      billingCustomerId,
      subscriptionId,
      invoice,
    }) {
      const values = {
        tenant_id: tenantId,
        billing_customer_id: billingCustomerId,
        subscription_id: subscriptionId,
        provider_invoice_id: invoice.providerInvoiceId,
        amount_cents: invoice.amountCents,
        currency: invoice.currency,
        status: invoice.status,
        hosted_url: invoice.hostedUrl,
        pdf_url: invoice.pdfUrl,
        issued_at: invoice.issuedAt.toISOString(),
        paid_at: invoice.paidAt?.toISOString() ?? null,
      };
      return await trx
        .insertInto('invoices')
        .values(values)
        .onConflict(
          (oc: {
            column: (col: string) => {
              doUpdateSet: (
                cb: (eb: {
                  ref: (col: string) => unknown;
                }) => Record<string, unknown>,
              ) => unknown;
            };
          }) =>
            oc.column('provider_invoice_id').doUpdateSet((eb) => ({
              amount_cents: eb.ref('excluded.amount_cents'),
              currency: eb.ref('excluded.currency'),
              status: eb.ref('excluded.status'),
              hosted_url: eb.ref('excluded.hosted_url'),
              pdf_url: eb.ref('excluded.pdf_url'),
              paid_at: eb.ref('excluded.paid_at'),
              updated_at: trx.fn('now'),
            })),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async findByProviderInvoiceId(providerInvoiceId) {
      return (
        (await trx
          .selectFrom('invoices')
          .selectAll()
          .where('provider_invoice_id', '=', providerInvoiceId)
          .executeTakeFirst()) ?? null
      );
    },

    async findStuckOpen({ olderThanMs, limit }) {
      const cutoff = new Date(Date.now() - olderThanMs).toISOString();
      return await trx
        .selectFrom('invoices')
        .selectAll()
        .where('status', '=', 'open')
        .where('issued_at', '<', cutoff)
        .orderBy('issued_at', 'asc')
        .limit(limit)
        .execute();
    },
  };
};
