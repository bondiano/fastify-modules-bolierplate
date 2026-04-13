import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { BaseConfig } from '@kit/config';

export interface ConfigPluginOptions {
  config: BaseConfig;
}

const configPlugin = async (
  fastify: FastifyInstance,
  options: ConfigPluginOptions,
) => {
  fastify.decorate('config', options.config);
};

export default fp(configPlugin, { name: 'config' });

declare module 'fastify' {
  interface FastifyInstance {
    config: BaseConfig;
  }
}
