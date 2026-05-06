import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('prices', async () => ({
  label: 'Prices',
  icon: 'dollar-sign',
  group: 'Billing',
  tenantScoped: false,
  scope: 'system',
  permissions: { subject: 'Price' },
  hidden: ['metadata'],
  list: {
    columns: [
      'providerPriceId',
      'planId',
      'currency',
      'amountCents',
      'interval',
      'isActive',
    ],
    search: ['providerPriceId'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['amountCents', 'currency', 'interval', 'isActive'],
    filters: [
      { name: 'planId', kind: 'select', label: 'Plan', options: 'distinct' },
      {
        name: 'currency',
        kind: 'select',
        label: 'Currency',
        options: 'distinct',
      },
      {
        name: 'interval',
        kind: 'select',
        label: 'Interval',
        options: 'distinct',
      },
      {
        name: 'isActive',
        kind: 'select',
        label: 'Active',
        options: 'distinct',
      },
    ],
  },
  widgets: { metadata: 'json' },
}));
