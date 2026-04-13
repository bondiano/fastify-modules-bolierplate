import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import {
  createErrorHandler,
  type CreateErrorHandlerOptions,
} from './handler.js';

export type ErrorHandlerPluginOptions = CreateErrorHandlerOptions;

const errorHandlerPlugin: FastifyPluginAsync<
  ErrorHandlerPluginOptions
> = async (fastify, options) => {
  fastify.setErrorHandler(createErrorHandler(options));
};

export const createErrorHandlerPlugin = fp(errorHandlerPlugin, {
  name: '@kit/errors',
});

export default createErrorHandlerPlugin;
