import type { DB } from '#db/schema.ts';
import {
  createSoftDeleteRepository,
  createSoftDeleteBulkOperations,
  applySearch,
} from '@kit/db/runtime';
import type { Trx } from '@kit/db/transaction';

interface PostsRepositoryDeps {
  transaction: Trx<DB>;
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

export const createPostsRepository = ({ transaction }: PostsRepositoryDeps) => {
  const base = createSoftDeleteRepository<DB, 'posts'>(transaction, 'posts');
  const bulk = createSoftDeleteBulkOperations<DB, 'posts'>(
    transaction,
    'posts',
  );

  return {
    ...base,
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (transaction as any)
        .selectFrom('posts')
        .selectAll()
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
