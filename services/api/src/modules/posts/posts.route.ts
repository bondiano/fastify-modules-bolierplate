import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Selectable } from 'kysely';

import type { DB } from '#db/schema.ts';
import { subject } from '@kit/authz';
import {
  idParameterSchema,
  paginatedQuerySchema,
  createOrderByQuerySchema,
  searchQuerySchema,
  createFilterQuerySchema,
  createSuccessResponseSchema,
  createPaginatedEnvelopeSchema,
  apiErrorEnvelopeSchema,
  StringEnum,
  ok,
  paginated,
} from '@kit/schemas';

import type { FindFilteredInput } from './posts.service.ts';
import { createPostBodySchema } from './schemas/create-post.schema.ts';
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

const postsRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  const { postsService, postsMapper } = fastify.diContainer.cradle;

  // GET /posts -- List posts (paginated, filtered) within the active tenant
  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['posts'],
      querystring: querySchema,
      response: {
        200: createPaginatedEnvelopeSchema(postResponseSchema),
      },
    },
    onRequest: [fastify.verifyUser],
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

  // GET /posts/:id -- scoped to the caller's active tenant
  fastify.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['posts'],
      params: idParameterSchema,
      response: {
        200: createSuccessResponseSchema(postResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request) => {
      const post = await postsService.findById(request.params.id);
      return ok(postsMapper.toResponse(post));
    },
  });

  // POST /posts -- Create post (authenticated)
  fastify.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['posts'],
      body: createPostBodySchema,
      response: {
        201: createSuccessResponseSchema(postResponseSchema),
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request, reply) => {
      const post = await postsService.create({
        ...request.body,
        authorId: request.auth!.sub,
      });
      return reply.status(201).send(ok(postsMapper.toResponse(post)));
    },
  });

  // PATCH /posts/:id -- Update post (authenticated, owner only)
  fastify.route({
    method: 'PATCH',
    url: '/:id',
    schema: {
      tags: ['posts'],
      params: idParameterSchema,
      body: updatePostBodySchema,
      response: {
        200: createSuccessResponseSchema(postResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    preHandler: [
      fastify.authorize('update', 'Post', async (request) => {
        const post = await postsService.findById(
          (request.params as { id: string }).id,
        );
        return subject('Post', post);
      }),
    ],
    handler: async (request) => {
      const post = await postsService.update(request.params.id, request.body);
      return ok(postsMapper.toResponse(post));
    },
  });

  // DELETE /posts/:id -- Soft delete post (authenticated, owner only)
  fastify.route({
    method: 'DELETE',
    url: '/:id',
    schema: {
      tags: ['posts'],
      params: idParameterSchema,
      response: {
        204: { type: 'null' as const },
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    preHandler: [
      fastify.authorize('delete', 'Post', async (request) => {
        const post = await postsService.findById(
          (request.params as { id: string }).id,
        );
        return subject('Post', post);
      }),
    ],
    handler: async (request, reply) => {
      await postsService.deleteById(request.params.id);
      return reply.status(204).send(null);
    },
  });
};

export default postsRoute;
export const autoPrefix = '/posts';
