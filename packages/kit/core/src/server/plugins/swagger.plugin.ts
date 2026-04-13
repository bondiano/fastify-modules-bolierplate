import Swagger from '@fastify/swagger';
import SwaggerUI from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface SwaggerPluginOptions {
  title?: string;
  version?: string;
  description?: string;
  routePrefix?: string;
  servers?: Array<{ url: string; description?: string }>;
}

const swaggerPlugin = async (
  fastify: FastifyInstance,
  options: SwaggerPluginOptions,
) => {
  const { APP_NAME, APP_VERSION } = fastify.config;
  const {
    title = APP_NAME,
    version = APP_VERSION,
    description,
    routePrefix = '/docs',
    servers,
  } = options;

  await fastify.register(Swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title,
        version,
        ...(description ? { description } : {}),
      },
      ...(servers ? { servers } : {}),
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await fastify.register(SwaggerUI, { routePrefix });
};

export default fp(swaggerPlugin, {
  name: 'swagger',
  dependencies: ['config'],
});
