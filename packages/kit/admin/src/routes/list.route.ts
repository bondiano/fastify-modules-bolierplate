/**
 * `GET /:resource` -- paginated sortable list view.
 *
 * Uses the repository's generic `findPaginatedByPage` for the happy path
 * and (when present) a module-specific `findFiltered` when the query
 * includes a search term. `findFiltered` is duck-typed; it must accept
 * `{ page, limit, orderBy, order, search }` and return `{ items, total }`.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { calculatePagination } from '@kit/schemas';

import { getRepo } from '../runtime/context.js';
import type { AdminDiscoverable, PaginatedPage } from '../types.js';
import { DataTable } from '../views/index.js';

import { assertAdminContext, respondHtml } from './_helpers.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ListQuery {
  readonly page?: unknown;
  readonly limit?: unknown;
  readonly orderBy?: unknown;
  readonly order?: unknown;
  readonly search?: unknown;
}

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

const parsePositiveInt = (
  v: unknown,
  fallback: number,
  max: number,
): number => {
  const s = asString(v);
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
};

const parseOrder = (v: unknown, fallback: 'asc' | 'desc'): 'asc' | 'desc' =>
  v === 'asc' || v === 'desc' ? v : fallback;

interface FilterOptions {
  page: number;
  limit: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

interface FilterableRepo extends AdminDiscoverable {
  findFiltered(opts: FilterOptions): Promise<PaginatedPage<unknown>>;
}

const hasFindFiltered = (repo: AdminDiscoverable): repo is FilterableRepo =>
  typeof (repo as { findFiltered?: unknown }).findFiltered === 'function';

export const listRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/:resource',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);

      const params = request.params as { resource?: string };
      const spec = ctx.registry.getOrThrow(params.resource ?? '');

      if (
        spec.permissions.subject !== null &&
        typeof fastify.authorize === 'function'
      ) {
        const hook = fastify.authorize('read', spec.permissions.subject);
        await hook(request);
      }

      const query = (request.query ?? {}) as ListQuery;
      const page = parsePositiveInt(
        query.page,
        DEFAULT_PAGE,
        Number.MAX_SAFE_INTEGER,
      );
      const limit = parsePositiveInt(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const orderBy = asString(query.orderBy) ?? spec.list.defaultSort.field;
      const order = parseOrder(query.order, spec.list.defaultSort.order);
      const search = asString(query.search);

      const repo = getRepo(ctx, spec);

      const result: PaginatedPage<unknown> =
        search && search.length > 0 && hasFindFiltered(repo)
          ? await repo.findFiltered({ page, limit, orderBy, order, search })
          : await repo.findPaginatedByPage({
              page,
              limit,
              orderByField: orderBy,
              orderByDirection: order,
            });

      const pagination = calculatePagination(page, limit, result.total);
      const rows = result.items.map((item) => item as Record<string, unknown>);

      const queryRecord: Record<string, string | undefined> = {
        orderBy,
        order,
        ...(search ? { search } : {}),
      };

      const table = DataTable({
        spec,
        rows,
        pagination,
        query: queryRecord,
        prefix: ctx.options.prefix,
      });

      return respondHtml(reply, request, ctx, table, {
        activeResource: spec.name,
      });
    },
  );
};

export default listRoute;
