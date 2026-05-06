import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('invoices', async () => ({
  label: 'Invoices',
  icon: 'file-text',
  group: 'Billing',
  tenantScoped: true,
  scope: 'tenant',
  readOnlyResource: true,
  permissions: { subject: 'Invoice' },
  list: {
    columns: [
      'providerInvoiceId',
      'status',
      'amountCents',
      'currency',
      'issuedAt',
      'paidAt',
    ],
    search: ['providerInvoiceId'],
    defaultSort: { field: 'issuedAt', order: 'desc' },
    sortableFields: ['issuedAt', 'amountCents', 'status'],
    filters: [
      { name: 'status', kind: 'select', label: 'Status', options: 'distinct' },
      { name: 'issuedAt', kind: 'date-range', label: 'Issued at' },
    ],
  },
}));
