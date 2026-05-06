import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('mail_deliveries', async () => ({
  label: 'Mail deliveries',
  icon: 'mail',
  group: 'System',
  // Tenant-scoped reads. The repository's `findFilteredAdmin` injects
  // `WHERE tenant_id = :current` directly; the kit-level flag mostly
  // serves the runtime tenant-required guard.
  tenantScoped: true,
  scope: 'tenant',
  // Pure forensic surface -- ops never edits these by hand.
  readOnlyResource: true,
  // Avoid recursive auditing: every admin view of the delivery list
  // would otherwise emit an audit row.
  auditEnabled: false,
  // `payload` (jsonb) frequently contains user-controlled data -- keep
  // it visible only on the detail page (rendered as JSON) and out of
  // the list grid.
  hidden: [
    'payload',
    'tags',
    'replyTo',
    'correlationId',
    'attempts',
    'templateVersion',
    'lastErrorCode',
    'lastErrorMessage',
    'failedAt',
    'openedAt',
    'clickedAt',
    'scheduledFor',
  ],
  // Treat the rendered subject + recipient as sensitive so the audit
  // diff utility (used by other resources) redacts equivalent payloads
  // when this resource is referenced by other code.
  sensitiveColumns: [],
  permissions: { subject: 'MailDelivery' },
  list: {
    columns: [
      'queuedAt',
      'status',
      'template',
      'toAddress',
      'subject',
      'provider',
    ],
    search: [],
    defaultSort: { field: 'queuedAt', order: 'desc' },
    sortableFields: ['queuedAt', 'status', 'template', 'toAddress'],
    filters: [
      {
        name: 'status',
        kind: 'select',
        label: 'Status',
        options: 'distinct',
      },
      {
        name: 'template',
        kind: 'select',
        label: 'Template',
        options: 'distinct',
      },
      { name: 'toAddress', kind: 'text', label: 'Recipient' },
      { name: 'queuedAt', kind: 'date-range', label: 'Queued at' },
    ],
  },
  widgets: { payload: 'json' },
}));
