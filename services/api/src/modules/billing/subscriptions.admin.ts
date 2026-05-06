import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('subscriptions', async () => ({
  label: 'Subscriptions',
  icon: 'repeat',
  group: 'Billing',
  tenantScoped: true,
  scope: 'tenant',
  readOnlyResource: true,
  permissions: { subject: 'Subscription' },
  hidden: ['metadata'],
  list: {
    columns: [
      'providerSubscriptionId',
      'status',
      'planId',
      'currentPeriodEnd',
      'cancelAt',
      'trialEnd',
    ],
    search: ['providerSubscriptionId'],
    defaultSort: { field: 'currentPeriodEnd', order: 'desc' },
    sortableFields: ['status', 'currentPeriodEnd', 'createdAt'],
    filters: [
      { name: 'status', kind: 'select', label: 'Status', options: 'distinct' },
      { name: 'planId', kind: 'select', label: 'Plan', options: 'distinct' },
      { name: 'createdAt', kind: 'date-range', label: 'Created at' },
    ],
  },
  detailActions: [
    {
      label: 'Sync from provider',
      method: 'POST',
      href: (id: string) => `/admin/subscriptions/${id}/sync`,
    },
    {
      label: 'Cancel at period end',
      method: 'POST',
      kind: 'danger',
      confirm: 'Cancel this subscription at the end of the current period?',
      href: (id: string) => `/admin/subscriptions/${id}/cancel`,
    },
  ],
  widgets: { metadata: 'json' },
}));
