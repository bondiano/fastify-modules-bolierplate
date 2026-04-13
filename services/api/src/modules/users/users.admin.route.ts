import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

import {
  idParameterSchema,
  paginatedQuerySchema,
  createOrderByQuerySchema,
  createSuccessResponseSchema,
  createPaginatedEnvelopeSchema,
  apiErrorEnvelopeSchema,
  ok,
  paginated,
} from '@kit/schemas';

import { updateUserBodySchema } from './schemas/update-user.schema.ts';
import { userResponseSchema } from './schemas/user-response.schema.ts';

const sortSchema = createOrderByQuerySchema(['createdAt', 'email', 'role']);
const querySchema = Type.Composite([paginatedQuerySchema, sortSchema]);

const usersAdminRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  const { usersService, usersMapper } = fastify.diContainer.cradle;

  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['admin', 'users'],
      querystring: querySchema,
      response: {
        200: createPaginatedEnvelopeSchema(userResponseSchema),
      },
    },
    onRequest: [fastify.verifyAdmin],
    handler: async (request) => {
      const { page, limit } = request.query;
      const result = await usersService.findPaginated(request.query);
      return paginated(
        result.items.map((item) => usersMapper.toResponse(item)),
        page,
        limit,
        result.total,
      );
    },
  });

  fastify.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['admin', 'users'],
      params: idParameterSchema,
      response: {
        200: createSuccessResponseSchema(userResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyAdmin],
    handler: async (request) => {
      const user = await usersService.findById(request.params.id);
      return ok(usersMapper.toResponse(user));
    },
  });

  fastify.route({
    method: 'PATCH',
    url: '/:id',
    schema: {
      tags: ['admin', 'users'],
      params: idParameterSchema,
      body: updateUserBodySchema,
      response: {
        200: createSuccessResponseSchema(userResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyAdmin],
    handler: async (request) => {
      const user = await usersService.update(request.params.id, request.body);
      return ok(usersMapper.toResponse(user));
    },
  });

  fastify.route({
    method: 'DELETE',
    url: '/:id',
    schema: {
      tags: ['admin', 'users'],
      params: idParameterSchema,
      response: {
        204: Type.Null(),
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyAdmin],
    handler: async (request, reply) => {
      await usersService.deleteById(request.params.id);
      return reply.status(204).send(null);
    },
  });
};

export default usersAdminRoute;
export const autoPrefix = '/admin/users';
