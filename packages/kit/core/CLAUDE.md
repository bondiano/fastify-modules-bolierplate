# @kit/core

Foundation layer for the Fastify SaaS Kit. Provides a DI container (Awilix),
config loader (znv+zod), Fastify server factory with core plugins, and a
graceful-shutdown helper.

## Directory

```
src/
  config/   createConfig + baseConfigSchema (znv/zod)
  di/       createContainer, formatName (suffix -> camelCase), global Dependencies type
  logger/   createLogger (pino, pretty in dev)
  server/
    create-server.ts     Fastify factory wiring security + core plugins
    graceful-shutdown.ts
    rate-limit.ts        withRateLimit helper for per-route rate limit overrides
    plugins/
      di.plugin.ts             @fastify/awilix
      request-context.plugin.ts @fastify/request-context
      health.plugin.ts         GET /health
      swagger.plugin.ts        @fastify/swagger + swagger-ui
      error-handler.plugin.ts  minimal; replaced by @kit/errors later
```

## Conventions

- **Auto-loading by suffix**: services/api modules matching
  `*.{repository,service,mapper,client}.{ts,js}` are auto-registered in the DI
  container under a camelCased key derived from the filename
  (`users.repository` -> `usersRepository`, `merchant-mids.repository` ->
  `merchantMidsRepository`).
- **Global `Dependencies` interface**: each business module extends it via
  `declare global { interface Dependencies { ... } }` for end-to-end type safety.
- **Function factories**: services are factory functions receiving destructured
  `Dependencies`, NOT classes/decorators.
- **Singleton lifetime** by default.

## Usage sketch

```ts
import {
  createConfig,
  createContainer,
  createLogger,
  createServer,
  setupGracefulShutdown,
} from '@kit/core';
import { z } from 'zod';

const config = createConfig({
  DATABASE_URL: z.string(),
});
const logger = createLogger({
  name: 'api',
  level: config.LOG_LEVEL,
  pretty: config.isDev,
});
const container = await createContainer({
  logger,
  config,
  modulesGlobs: [
    `${import.meta.dirname}/modules/**/*.{repository,service,mapper,client}.{js,ts}`,
  ],
});

const server = await createServer({
  container,
  logger,
  appName: config.APP_NAME,
  appVersion: config.APP_VERSION,
  pluginsDir: `${import.meta.dirname}/server/plugins`,
  modulesDir: `${import.meta.dirname}/modules`,
});

setupGracefulShutdown(async () => {
  await server.close();
}, logger);
await server.listen({ host: config.HOST, port: config.PORT });
```

## Security defaults

`createServer` registers `@fastify/helmet`, `@fastify/cors`, and
`@fastify/rate-limit` by default. Pass `security.<plugin>: false` to disable
or an options object to override. **Don't disable unless you're replacing with
equivalent protection upstream.**

## Per-route rate limiting

Use `withRateLimit` to override the global rate limit on specific routes:

```ts
import { withRateLimit } from '@kit/core';

fastify.route({
  method: 'POST',
  url: '/auth/login',
  ...withRateLimit({ max: 5, timeWindow: '1 minute' }),
  handler: async (request, reply) => { ... },
});

// Disable rate limiting for a specific route:
fastify.route({
  method: 'GET',
  url: '/health',
  ...withRateLimit(false),
  handler: async (request, reply) => { ... },
});
```
