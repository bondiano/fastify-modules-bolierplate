import type { DB } from '#db/schema.ts';
import { applySearch, createSoftDeleteBulkOperations } from '@kit/db/runtime';
import type { Trx } from '@kit/db/transaction';
import {
  createTenantScopedSoftDeleteRepository,
  type TenantContext,
} from '@kit/tenancy';

interface PostsRepositoryDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

interface FindFilteredOptions {
  search?: string;
  status?: string;
  authorId?: string;
  page?: number;
  limit?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
}

export const createPostsRepository = ({
  transaction,
  tenantContext,
}: PostsRepositoryDeps) => {
  const scoped = createTenantScopedSoftDeleteRepository<DB, 'posts'>({
    transaction,
    tenantContext,
    tableName: 'posts',
  });
  // Bulk operations are not yet tenant-scoped in the kit. Admin bulk
  // mutations rely on the route's `assertTenantForResource` guard for
  // safety; a future kit rev can layer the same `WHERE tenant_id`
  // predicate onto the bulk paths.
  const bulk = createSoftDeleteBulkOperations<DB, 'posts'>(
    transaction,
    'posts',
  );

  const currentTenantId = (): string => tenantContext.currentTenant().tenantId;

  return {
    ...scoped,
    ...bulk,

    findFiltered: async ({
      search,
      status,
      authorId,
      page = 1,
      limit = 20,
      orderBy = 'createdAt',
      order = 'desc',
    }: FindFilteredOptions) => {
      const offset = (page - 1) * limit;
      const tenantId = currentTenantId();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (transaction as any)
        .selectFrom('posts')
        .selectAll()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where((transaction as any).dynamic.ref('tenantId'), '=', tenantId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where((transaction as any).dynamic.ref('deletedAt'), 'is', null);

      if (search) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = applySearch(query, transaction as any, search, [
          'title',
          'content',
        ]);
      }
      if (status) {
        query = query.where('status', '=', status);
      }
      if (authorId) {
        query = query.where('authorId', '=', authorId);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let countQuery = (transaction as any)
        .selectFrom('posts')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where((transaction as any).dynamic.ref('tenantId'), '=', tenantId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where((transaction as any).dynamic.ref('deletedAt'), 'is', null);

      if (search) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        countQuery = applySearch(countQuery, transaction as any, search, [
          'title',
          'content',
        ]);
      }
      if (status) {
        countQuery = countQuery.where('status', '=', status);
      }
      if (authorId) {
        countQuery = countQuery.where('authorId', '=', authorId);
      }

      const [items, countRow] = await Promise.all([
        query
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .orderBy((transaction as any).dynamic.ref(orderBy), order)
          .limit(limit)
          .offset(offset)
          .execute(),
        countQuery
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .select((r: any) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            r.fn.count((transaction as any).dynamic.ref('id')).as('count'),
          )
          .executeTakeFirstOrThrow(),
      ]);

      return { items, total: Number(countRow.count) };
    },
  };
};

export type PostsRepository = ReturnType<typeof createPostsRepository>;
