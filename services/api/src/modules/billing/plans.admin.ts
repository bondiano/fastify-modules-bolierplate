import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('plans', async () => ({
  label: 'Plans',
  icon: 'tag',
  group: 'Billing',
  tenantScoped: false,
  scope: 'system',
  permissions: { subject: 'Plan' },
  list: {
    columns: ['slug', 'name', 'isActive', 'createdAt'],
    search: ['slug', 'name'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['slug', 'name', 'createdAt', 'isActive'],
    filters: [
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
