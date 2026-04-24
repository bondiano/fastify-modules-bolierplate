import type { ModuleNames } from '../util/names.ts';

export const repositoryTemplate = ({
  plural,
}: ModuleNames): string => `import type { DB } from '#db/schema.ts';
import {
  createSoftDeleteRepository,
  createSoftDeleteBulkOperations,
} from '@kit/db/runtime';
import type { Trx } from '@kit/db/transaction';

interface ${plural.pascal}RepositoryDeps {
  transaction: Trx<DB>;
}

interface FindFilteredOptions {
  page?: number;
  limit?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
}

export const create${plural.pascal}Repository = ({
  transaction,
}: ${plural.pascal}RepositoryDeps) => {
  const base = createSoftDeleteRepository<DB, '${plural.camel}'>(
    transaction,
    '${plural.camel}',
  );
  const bulk = createSoftDeleteBulkOperations<DB, '${plural.camel}'>(
    transaction,
    '${plural.camel}',
  );

  return {
    ...base,
    ...bulk,

    findFiltered: async ({
      page = 1,
      limit = 20,
      orderBy = 'createdAt',
      order = 'desc',
    }: FindFilteredOptions) => {
      return base.findPaginatedByPage({
        page,
        limit,
        orderByField: orderBy,
        orderByDirection: order,
      });
    },
  };
};

export type ${plural.pascal}Repository = ReturnType<typeof create${plural.pascal}Repository>;
`;
