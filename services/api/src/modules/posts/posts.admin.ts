import { defineAdminResource } from '@kit/admin';

/**
 * Admin panel override for the `posts` resource. Everything not touched
 * here falls back to the spec inferred from `information_schema` at boot.
 *
 * The default column list + text widgets are already fine for posts --
 * we just add domain niceties: prettier label, icon, grouped form
 * fieldsets, a radio group for the short `status` enum, and explicit
 * CASL subject.
 */
export default defineAdminResource('posts', async () => ({
  label: 'Posts',
  icon: 'file-text',
  hidden: ['deletedAt'],
  readOnly: ['id', 'createdAt', 'updatedAt'],
  widgets: {
    content: 'textarea',
    status: 'radio-group',
  },
  enumValues: {
    status: ['draft', 'published', 'archived'],
  },
  list: {
    columns: ['title', 'status', 'authorId', 'createdAt'],
    search: ['title', 'content'],
    defaultSort: { field: 'createdAt', order: 'desc' },
    sortableFields: ['title', 'status', 'createdAt', 'updatedAt'],
  },
  form: {
    fieldsets: [
      { label: 'Content', fields: ['title', 'content', 'status'] },
      { label: 'Meta', fields: ['authorId'], collapsed: true },
    ],
  },
  permissions: { subject: 'Post' },
}));
