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
  readOnly: ['id', 'createdAt', 'updatedAt', 'emailVerifiedAt'],
  widgets: {
    role: 'radio-group',
  },
  enumValues: {
    role: ['admin', 'user'],
  },
  // `passwordHash` already hidden from forms, but the audit kit's diff
  // utility runs over admin-side payloads too -- list it here so the
  // global pattern set is reinforced for this resource.
  sensitiveColumns: ['passwordHash'],
  list: {
    columns: ['email', 'role', 'emailVerifiedAt', 'createdAt'],
    search: ['email'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['email', 'role', 'createdAt', 'updatedAt'],
  },
  form: {
    fieldsets: [
      { label: 'Account', fields: ['email', 'role'] },
      {
        label: 'Meta',
        fields: ['id', 'emailVerifiedAt', 'createdAt', 'updatedAt'],
        collapsed: true,
      },
    ],
  },
  detailActions: [
    {
      label: 'Force password reset',
      method: 'POST',
      href: (id) => `/admin/users/${id}/force-password-reset`,
      confirm: 'Send a password reset link to this user?',
    },
    {
      label: 'Resend verification',
      method: 'POST',
      href: (id) => `/admin/users/${id}/resend-verification`,
      confirm: 'Send a fresh email verification link?',
    },
  ],
  permissions: { subject: 'User' },
}));
