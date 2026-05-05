/**
 * `GET /:resource` -- paginated sortable list view.
 *
 * Order of preference for the data fetch:
 *   1. `repo.findFilteredAdmin({ ...filters, search, page, limit, orderBy, order })`
 *      when the repository declares it AND the request carries any
 *      filter / search input.
 *   2. `repo.findFiltered({ page, limit, orderBy, order, search })` when
 *      a search term is present and `findFiltered` exists (legacy
 *      module-defined search). Filters are silently ignored on this
 *      path.
 *   3. `repo.findPaginatedByPage` for the plain paginated case.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { calculatePagination } from '@kit/schemas';

import { getRepo } from '../runtime/context.js';
import type {
  AdminDiscoverable,
  AdminFilterOptions,
  AdminResourceSpec,
  PaginatedPage,
} from '../types.js';
import { DataTable } from '../views/index.js';

import {
  assertAdminContext,
  assertTenantForResource,
  respondHtml,
} from './_helpers.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

interface LegacyFilterOptions {
  page: number;
  limit: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

interface LegacyFilterableRepo extends AdminDiscoverable {
  findFiltered(opts: LegacyFilterOptions): Promise<PaginatedPage<unknown>>;
}

interface AdminFilterableRepo extends AdminDiscoverable {
  findFilteredAdmin(opts: AdminFilterOptions): Promise<PaginatedPage<unknown>>;
}

const hasLegacyFindFiltered = (
  repo: AdminDiscoverable,
): repo is LegacyFilterableRepo =>
  typeof (repo as { findFiltered?: unknown }).findFiltered === 'function';

const hasFindFilteredAdmin = (
  repo: AdminDiscoverable,
): repo is AdminFilterableRepo =>
  typeof (repo as { findFilteredAdmin?: unknown }).findFilteredAdmin ===
  'function';

/**
 * Pick the keys this resource recognises out of the request query and
 * drop empty strings -- the data-table renders the empty value as "All"
 * and the user's "Clear" submit posts empties for every field.
 */
const collectFilters = (
  spec: AdminResourceSpec,
  query: Record<string, unknown>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const f of spec.list.filters) {
    if (f.kind === 'date-range') {
      const from = asString(query[`${f.name}From`]);
      const to = asString(query[`${f.name}To`]);
      if (from && from.length > 0) out[`${f.name}From`] = from;
      if (to && to.length > 0) out[`${f.name}To`] = to;
    } else {
      const v = asString(query[f.name]);
      if (v && v.length > 0) out[f.name] = v;
    }
  }
  return out;
};

export const listRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/:resource',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = assertAdminContext(fastify);

      const params = request.params as { resource?: string };
      const spec = ctx.registry.getOrThrow(params.resource ?? '');
      assertTenantForResource(spec, request);

      if (
        spec.permissions.subject !== null &&
        typeof fastify.authorize === 'function'
      ) {
        const hook = fastify.authorize('read', spec.permissions.subject);
        await hook(request);
      }

      const query = (request.query ?? {}) as Record<string, unknown>;
      const page = parsePositiveInt(
        query['page'],
        DEFAULT_PAGE,
        Number.MAX_SAFE_INTEGER,
      );
      const limit = parsePositiveInt(query['limit'], DEFAULT_LIMIT, MAX_LIMIT);
      const orderBy = asString(query['orderBy']) ?? spec.list.defaultSort.field;
      const order = parseOrder(query['order'], spec.list.defaultSort.order);
      const search = asString(query['search']);

      const filters = collectFilters(spec, query);
      const hasFilterInput =
        Object.keys(filters).length > 0 || (search && search.length > 0);

      const repo = getRepo(ctx, spec);

      let result: PaginatedPage<unknown>;
      if (hasFilterInput && hasFindFilteredAdmin(repo)) {
        const opts: AdminFilterOptions = {
          page,
          limit,
          orderBy,
          order,
          ...(search ? { search } : {}),
          filters,
        };
        result = await repo.findFilteredAdmin(opts);
      } else if (search && search.length > 0 && hasLegacyFindFiltered(repo)) {
        result = await repo.findFiltered({
          page,
          limit,
          orderBy,
          order,
          search,
        });
      } else {
        result = await repo.findPaginatedByPage({
          page,
          limit,
          orderByField: orderBy,
          orderByDirection: order,
        });
      }

      const pagination = calculatePagination(page, limit, result.total);
      const rows = result.items.map((item) => item as Record<string, unknown>);

      const queryRecord: Record<string, string | undefined> = {
        orderBy,
        order,
        ...(search ? { search } : {}),
        ...filters,
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
