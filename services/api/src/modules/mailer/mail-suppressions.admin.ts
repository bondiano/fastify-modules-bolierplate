import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('mail_suppressions', async () => ({
  label: 'Mail suppressions',
  icon: 'shield-alert',
  group: 'System',
  // Tenant-scoped: each tenant manages its own do-not-send list.
  // Global suppressions (tenant_id IS NULL) are visible only via the
  // unscoped admin escape hatch.
  tenantScoped: true,
  scope: 'tenant',
  // Reads are admin-curated; manual additions go through the kit's
  // generic create form. Bulk imports / SES/Postmark webhook ingestion
  // populate this table automatically -- the admin can see all of
  // them here.
  readOnlyResource: false,
  // Audit every manual change so an "Why is x@y.com blocked?" support
  // ticket has a paper trail.
  auditEnabled: true,
  hidden: [],
  permissions: { subject: 'MailSuppression' },
  list: {
    columns: ['emailLower', 'reason', 'source', 'createdAt', 'expiresAt'],
    search: ['emailLower', 'source'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['createdAt', 'reason', 'emailLower'],
    filters: [
      { name: 'reason', kind: 'select', label: 'Reason', options: 'distinct' },
      { name: 'createdAt', kind: 'date-range', label: 'Added' },
    ],
  },
}));
