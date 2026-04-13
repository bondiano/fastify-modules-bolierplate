import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import {
  idParameterSchema,
  createSuccessResponseSchema,
  apiErrorEnvelopeSchema,
  ok,
} from '@kit/schemas';

import { userResponseSchema } from './schemas/user-response.schema.ts';

const usersRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  const { usersService, usersMapper } = fastify.diContainer.cradle;

  fastify.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['users'],
      params: idParameterSchema,
      response: {
        200: createSuccessResponseSchema(userResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request) => {
      const user = await usersService.findById(request.params.id);
      return ok(usersMapper.toResponse(user));
    },
  });

  fastify.route({
    method: 'GET',
    url: '/me',
    schema: {
      tags: ['users'],
      response: {
        200: createSuccessResponseSchema(userResponseSchema),
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request) => {
      const user = await usersService.findById(request.auth!.sub);
      return ok(usersMapper.toResponse(user));
    },
  });
};

export default usersRoute;
export const autoPrefix = '/users';
