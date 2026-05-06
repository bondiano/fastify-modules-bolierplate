import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('payment_methods', async () => ({
  label: 'Payment methods',
  icon: 'credit-card',
  group: 'Billing',
  tenantScoped: true,
  scope: 'tenant',
  readOnlyResource: true,
  // Audit-emitted diffs scrub these (audit_log diff utility honors
  // sensitiveColumns when computing the before/after JSON diff).
  sensitiveColumns: ['brand', 'last4'],
  permissions: { subject: 'PaymentMethod' },
  list: {
    columns: [
      'providerPaymentMethodId',
      'type',
      'brand',
      'last4',
      'isDefault',
      'createdAt',
    ],
    search: ['providerPaymentMethodId'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['createdAt', 'type', 'isDefault'],
    filters: [
      { name: 'type', kind: 'select', label: 'Type', options: 'distinct' },
      { name: 'brand', kind: 'select', label: 'Brand', options: 'distinct' },
    ],
  },
}));
