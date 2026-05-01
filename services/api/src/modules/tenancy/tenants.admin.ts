import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('tenants', async () => ({
  label: 'Tenants',
  icon: 'building',
  group: 'Tenancy',
  // The `tenants` table is system-level: it governs tenants themselves,
  // so admin reads are cross-tenant.
  tenantScoped: false,
  scope: 'system',
  hidden: ['deletedAt'],
  readOnly: ['id', 'createdAt', 'updatedAt'],
  list: {
    columns: ['name', 'slug', 'createdAt'],
    search: ['name', 'slug'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['name', 'slug', 'createdAt'],
  },
  permissions: { subject: 'Tenant' },
}));
