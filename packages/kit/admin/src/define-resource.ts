import type { AdminOverrideFactory, AdminResourceDefinition } from './types.js';

/**
 * Register a resource-level override that layers on top of the
 * inferred spec. The factory receives the DI cradle and the schema
 * registry and runs once at plugin boot, after the registry is built
 * and the DI container is fully wired but before any admin route is
 * registered.
 *
 * The returned definition is a pure data bag -- no side effects.
 *
 * @example
 * ```ts
 * export default defineAdminResource('posts', async ({ cradle }) => ({
 *   label: 'Posts',
 *   icon: 'file-text',
 *   hidden: ['deletedAt'],
 *   readOnly: ['id', 'createdAt', 'updatedAt'],
 *   widgets: { content: 'textarea', status: 'radio-group' },
 *   permissions: { subject: 'Post' },
 * }));
 * ```
 */
export const defineAdminResource = (
  table: string,
  factory: AdminOverrideFactory,
): AdminResourceDefinition => ({ table, factory });
