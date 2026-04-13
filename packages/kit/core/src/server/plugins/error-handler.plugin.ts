import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';

/**
 * Minimal error handler for @kit/core. @kit/errors will replace this with a
 * structured exception hierarchy. For now we just map known Fastify errors and
 * fall back to 500 for anything unexpected.
 */
const errorHandlerPlugin = async (fastify: FastifyInstance) => {
  fastify.setErrorHandler(
    (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      const statusCode = error.statusCode ?? 500;

      if (statusCode >= 500) {
        request.log.error({ err: error }, 'Unhandled error');
      } else {
        request.log.warn({ err: error }, 'Request error');
      }

      return reply.status(statusCode).send({
        data: null,
        error: {
          statusCode,
          error: error.name || 'Error',
          message: error.message || 'Internal Server Error',
        },
      });
    },
  );
};

export default fp(errorHandlerPlugin, { name: 'error-handler' });
