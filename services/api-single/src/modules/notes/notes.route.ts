import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Selectable } from 'kysely';

import type { DB } from '#db/schema.ts';
import {
  apiErrorEnvelopeSchema,
  createPaginatedEnvelopeSchema,
  createSuccessResponseSchema,
  idParameterSchema,
  ok,
  paginated,
  paginatedQuerySchema,
} from '@kit/schemas';

import { createNoteBodySchema } from './schemas/create-note.schema.ts';
import { noteResponseSchema } from './schemas/note-response.schema.ts';
import { updateNoteBodySchema } from './schemas/update-note.schema.ts';

const notesRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  const { notesService, notesMapper } = fastify.diContainer.cradle;

  fastify.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['notes'],
      querystring: paginatedQuerySchema,
      response: {
        200: createPaginatedEnvelopeSchema(noteResponseSchema),
      },
    },
    handler: async (request) => {
      const page = request.query.page ?? 1;
      const limit = request.query.limit ?? 20;
      const result = await notesService.findPaginated(page, limit);
      return paginated(
        result.items.map((item: Selectable<DB['notes']>) =>
          notesMapper.toResponse(item),
        ),
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
      tags: ['notes'],
      params: idParameterSchema,
      response: {
        200: createSuccessResponseSchema(noteResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request) => {
      const note = await notesService.findById(request.params.id);
      return ok(notesMapper.toResponse(note));
    },
  });

  fastify.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['notes'],
      body: createNoteBodySchema,
      response: {
        201: createSuccessResponseSchema(noteResponseSchema),
      },
    },
    handler: async (request, reply) => {
      const note = await notesService.create(request.body);
      return reply.status(201).send(ok(notesMapper.toResponse(note)));
    },
  });

  fastify.route({
    method: 'PATCH',
    url: '/:id',
    schema: {
      tags: ['notes'],
      params: idParameterSchema,
      body: updateNoteBodySchema,
      response: {
        200: createSuccessResponseSchema(noteResponseSchema),
        404: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request) => {
      const note = await notesService.update(request.params.id, request.body);
      return ok(notesMapper.toResponse(note));
    },
  });

  fastify.route({
    method: 'DELETE',
    url: '/:id',
    schema: {
      tags: ['notes'],
      params: idParameterSchema,
      response: {
        204: { type: 'null' as const },
        404: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request, reply) => {
      await notesService.deleteById(request.params.id);
      return reply.status(204).send(null);
    },
  });
};

export default notesRoute;
export const autoPrefix = '/notes';
