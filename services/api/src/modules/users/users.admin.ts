import { defineAdminResource } from '@kit/admin';

/**
 * Admin panel override for the `users` resource. Hides the password hash,
 * locks identity + audit columns as read-only, and constrains `role` to the
 * two valid values. Everything else falls back to the spec inferred from
 * `information_schema` at boot.
 */
export default defineAdminResource('users', async () => ({
  label: 'Users',
  icon: 'users',
  hidden: ['passwordHash'],
  readOnly: ['id', 'createdAt', 'updatedAt'],
  widgets: {
    role: 'radio-group',
  },
  enumValues: {
    role: ['admin', 'user'],
  },
  list: {
    columns: ['email', 'role', 'createdAt'],
    search: ['email'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['email', 'role', 'createdAt', 'updatedAt'],
  },
  form: {
    fieldsets: [
      { label: 'Account', fields: ['email', 'role'] },
      {
        label: 'Meta',
        fields: ['id', 'createdAt', 'updatedAt'],
        collapsed: true,
      },
    ],
  },
  permissions: { subject: 'User' },
}));
