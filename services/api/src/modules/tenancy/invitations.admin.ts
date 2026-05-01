import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('invitations', async () => ({
  label: 'Invitations',
  icon: 'mail',
  group: 'Tenancy',
  // Token hash is sensitive and the inviter never re-reads it; hide
  // from list + form views.
  hidden: ['tokenHash'],
  readOnly: ['id', 'tenantId', 'tokenHash', 'createdAt', 'acceptedAt'],
  enumValues: {
    role: ['owner', 'admin', 'member'],
  },
  widgets: {
    role: 'radio-group',
  },
  list: {
    columns: ['email', 'role', 'expiresAt', 'acceptedAt', 'createdAt'],
    search: ['email'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['email', 'role', 'expiresAt', 'createdAt'],
  },
  permissions: { subject: 'Invitation' },
  detailActions: [
    {
      // Mints a fresh token + extends `expires_at` and re-fires the
      // `onInvitationCreated` event (which a wired mailer adapter
      // reads to resend the accept link). The accept URL is rendered
      // back on success so an admin can manually copy it before the
      // mailer is wired (P2.mailer.*).
      label: 'Resend invitation',
      method: 'POST',
      href: (id) => `/admin/invitations/${id}/regenerate`,
      confirm: 'Generate a new accept link? The old one will stop working.',
    },
  ],
}));
