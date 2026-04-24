import type { ModuleNames } from '../util/names.ts';

export const routeTemplate = ({
  plural,
  singular,
}: ModuleNames): string => `import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Selectable } from 'kysely';

import type { DB } from '#db/schema.ts';
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

import type { FindFilteredInput } from './${plural.kebab}.service.ts';
import { create${singular.pascal}BodySchema } from './schemas/create-${singular.kebab}.schema.ts';
import { ${singular.camel}ResponseSchema } from './schemas/${singular.kebab}-response.schema.ts';
import { update${singular.pascal}BodySchema } from './schemas/update-${singular.kebab}.schema.ts';

const sortSchema = createOrderByQuerySchema(['createdAt', 'name']);
const querySchema = Type.Composite([paginatedQuerySchema, sortSchema]);

const ${plural.camel}Route: FastifyPluginAsyncTypebox = async (fastify) => {
  const { ${plural.camel}Service, ${plural.camel}Mapper } = fastify.diContainer.cradle;

  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['${plural.kebab}'],
      querystring: querySchema,
      response: {
        200: createPaginatedEnvelopeSchema(${singular.camel}ResponseSchema),
      },
    },
    handler: async (request) => {
      const query = request.query as FindFilteredInput;
      const result = await ${plural.camel}Service.findFiltered(query);
      return paginated(
        result.items.map((item: Selectable<DB['${plural.camel}']>) =>
          ${plural.camel}Mapper.toResponse(item),
        ),
        query.page ?? 1,
        query.limit ?? 20,
        result.total,
      );
    },
  });

  fastify.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['${plural.kebab}'],
      params: idParameterSchema,
      response: {
        200: createSuccessResponseSchema(${singular.camel}ResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request) => {
      const ${singular.camel} = await ${plural.camel}Service.findById(request.params.id);
      return ok(${plural.camel}Mapper.toResponse(${singular.camel}));
    },
  });

  fastify.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['${plural.kebab}'],
      body: create${singular.pascal}BodySchema,
      response: {
        201: createSuccessResponseSchema(${singular.camel}ResponseSchema),
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request, reply) => {
      const ${singular.camel} = await ${plural.camel}Service.create(request.body);
      return reply
        .status(201)
        .send(ok(${plural.camel}Mapper.toResponse(${singular.camel})));
    },
  });

  fastify.route({
    method: 'PATCH',
    url: '/:id',
    schema: {
      tags: ['${plural.kebab}'],
      params: idParameterSchema,
      body: update${singular.pascal}BodySchema,
      response: {
        200: createSuccessResponseSchema(${singular.camel}ResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request) => {
      const ${singular.camel} = await ${plural.camel}Service.update(
        request.params.id,
        request.body,
      );
      return ok(${plural.camel}Mapper.toResponse(${singular.camel}));
    },
  });

  fastify.route({
    method: 'DELETE',
    url: '/:id',
    schema: {
      tags: ['${plural.kebab}'],
      params: idParameterSchema,
      response: {
        204: { type: 'null' as const },
        404: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request, reply) => {
      await ${plural.camel}Service.deleteById(request.params.id);
      return reply.status(204).send(null);
    },
  });
};

export default ${plural.camel}Route;
export const autoPrefix = '/${plural.kebab}';
`;
