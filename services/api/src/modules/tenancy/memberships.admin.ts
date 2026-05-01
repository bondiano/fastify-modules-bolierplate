import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('memberships', async () => ({
  label: 'Memberships',
  icon: 'users',
  group: 'Tenancy',
  readOnly: ['id', 'tenantId', 'userId', 'createdAt', 'joinedAt'],
  enumValues: {
    role: ['owner', 'admin', 'member'],
  },
  widgets: {
    role: 'radio-group',
  },
  list: {
    columns: ['userId', 'role', 'joinedAt', 'createdAt'],
    search: [],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['role', 'createdAt', 'joinedAt'],
  },
  permissions: { subject: 'Membership' },
}));
