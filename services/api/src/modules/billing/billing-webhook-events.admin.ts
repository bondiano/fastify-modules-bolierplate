import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('billing_webhook_events', async () => ({
  label: 'Billing webhook events',
  icon: 'activity',
  group: 'Billing',
  tenantScoped: false,
  scope: 'system',
  readOnlyResource: true,
  // Default-hidden because the table is forensic-only -- toggle the
  // resource visibility flag to surface during incident triage.
  hidden: ['payload'],
  permissions: { subject: 'BillingWebhookEvent' },
  list: {
    columns: [
      'provider',
      'providerEventId',
      'type',
      'receivedAt',
      'processedAt',
      'error',
    ],
    search: ['providerEventId', 'type'],
    defaultSort: { field: 'receivedAt', order: 'desc' },
    sortableFields: ['receivedAt', 'processedAt', 'type'],
    filters: [
      {
        name: 'provider',
        kind: 'select',
        label: 'Provider',
        options: 'distinct',
      },
      { name: 'type', kind: 'select', label: 'Type', options: 'distinct' },
      { name: 'receivedAt', kind: 'date-range', label: 'Received at' },
    ],
  },
  widgets: { payload: 'json' },
}));
