import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Selectable } from 'kysely';

import type { DB } from '#db/schema.ts';
import {
  idParameterSchema,
  paginatedQuerySchema,
  createOrderByQuerySchema,
  searchQuerySchema,
  createFilterQuerySchema,
  createSuccessResponseSchema,
  createPaginatedEnvelopeSchema,
  apiErrorEnvelopeSchema,
  bulkIdsSchema,
  bulkDeleteResponseSchema,
  createBulkUpdateSchema,
  bulkUpdateResponseSchema,
  StringEnum,
  ok,
  paginated,
} from '@kit/schemas';

import type { FindFilteredInput } from './posts.service.ts';
import { postResponseSchema } from './schemas/post-response.schema.ts';
import { updatePostBodySchema } from './schemas/update-post.schema.ts';

const sortSchema = createOrderByQuerySchema(['createdAt', 'title', 'status']);
const postFilters = createFilterQuerySchema({
  status: StringEnum(['draft', 'published']),
  authorId: Type.String(),
});
const querySchema = Type.Composite([
  paginatedQuerySchema,
  sortSchema,
  searchQuerySchema,
  postFilters,
]);

const bulkUpdateBody = createBulkUpdateSchema(updatePostBodySchema);

const postsAdminRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  const { postsService, postsMapper } = fastify.diContainer.cradle;

  // GET /admin/posts
  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['admin', 'posts'],
      querystring: querySchema,
      response: {
        200: createPaginatedEnvelopeSchema(postResponseSchema),
      },
    },
    onRequest: [fastify.verifyAdmin],
    handler: async (request) => {
      const query = request.query as FindFilteredInput;
      const result = await postsService.findFiltered(query);
      return paginated(
        result.items.map((item: Selectable<DB['posts']>) =>
          postsMapper.toResponse(item),
        ),
        query.page ?? 1,
        query.limit ?? 20,
        result.total,
      );
    },
  });

  // GET /admin/posts/:id
  fastify.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['admin', 'posts'],
      params: idParameterSchema,
      response: {
        200: createSuccessResponseSchema(postResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyAdmin],
    handler: async (request) => {
      const post = await postsService.findById(request.params.id);
      return ok(postsMapper.toResponse(post));
    },
  });

  // PATCH /admin/posts/:id
  fastify.route({
    method: 'PATCH',
    url: '/:id',
    schema: {
      tags: ['admin', 'posts'],
      params: idParameterSchema,
      body: updatePostBodySchema,
      response: {
        200: createSuccessResponseSchema(postResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyAdmin],
    handler: async (request) => {
      const post = await postsService.update(request.params.id, request.body);
      return ok(postsMapper.toResponse(post));
    },
  });

  // DELETE /admin/posts/:id
  fastify.route({
    method: 'DELETE',
    url: '/:id',
    schema: {
      tags: ['admin', 'posts'],
      params: idParameterSchema,
      response: {
        204: { type: 'null' as const },
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyAdmin],
    handler: async (request, reply) => {
      await postsService.deleteById(request.params.id);
      return reply.status(204).send(null);
    },
  });

  // POST /admin/posts/bulk-delete
  fastify.route({
    method: 'POST',
    url: '/bulk-delete',
    schema: {
      tags: ['admin', 'posts'],
      body: bulkIdsSchema,
      response: {
        200: bulkDeleteResponseSchema,
      },
    },
    onRequest: [fastify.verifyAdmin],
    handler: async (request) => {
      const deletedCount = await postsService.bulkDelete(request.body.ids);
      return ok({ deletedCount });
    },
  });

  // PATCH /admin/posts/bulk-update
  fastify.route({
    method: 'PATCH',
    url: '/bulk-update',
    schema: {
      tags: ['admin', 'posts'],
      body: bulkUpdateBody,
      response: {
        200: bulkUpdateResponseSchema,
      },
    },
    onRequest: [fastify.verifyAdmin],
    handler: async (request) => {
      const updatedCount = await postsService.bulkUpdate(
        request.body.ids,
        request.body.data,
      );
      return ok({ updatedCount });
    },
  });
};

export default postsAdminRoute;
export const autoPrefix = '/admin/posts';
