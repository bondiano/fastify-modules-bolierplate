import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('audit_log', async () => ({
  label: 'Audit log',
  icon: 'history',
  group: 'System',
  // Tenant-scoped reads (every admin who lists audit rows works inside a
  // tenant frame). The repository's `findFilteredAdmin` injects the
  // `WHERE tenant_id = :current` clause directly so the kit's generic
  // `tenantScoped` flag is mostly cosmetic for the resource -- but we
  // keep it `true` for the runtime `assertTenantForResource` guard.
  tenantScoped: true,
  scope: 'tenant',
  // Forensic surface: no inline edits, no deletes, no "New" button.
  readOnlyResource: true,
  // Don't audit reads/views of the audit log itself.
  auditEnabled: false,
  hidden: ['ip', 'userAgent', 'metadata'],
  permissions: { subject: 'AuditLog' },
  list: {
    columns: [
      'createdAt',
      'actorId',
      'subjectType',
      'subjectId',
      'action',
      'sensitive',
    ],
    search: [],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['createdAt', 'subjectType', 'action'],
    filters: [
      { name: 'actorId', kind: 'text', label: 'Actor (user id)' },
      {
        name: 'subjectType',
        kind: 'select',
        label: 'Subject',
        options: 'distinct',
      },
      {
        name: 'action',
        kind: 'select',
        label: 'Action',
        options: 'distinct',
      },
      { name: 'createdAt', kind: 'date-range', label: 'Date range' },
    ],
  },
  widgets: { diff: 'json-diff', metadata: 'json' },
}));
