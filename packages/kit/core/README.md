# @kit/core

Foundation layer of the Fastify SaaS Kit. Wires up the things every service
needs before any business code exists: config, logger, DI container, Fastify
factory with security plugins, health endpoint, OpenAPI, graceful shutdown.

> If you're an AI agent: read `CLAUDE.md` next to this file for the strict
> conventions (auto-loading, naming, factory style). This README is the
> human-friendly tour.

## What's inside

```
src/
  config/   createConfig + baseConfigSchema   znv + zod env loader
  logger/   createLogger                       pino, pretty in dev
  di/       createContainer + formatName       awilix, suffix-based auto-loading
  server/
    create-server.ts                           Fastify factory
    graceful-shutdown.ts                       SIGTERM/SIGINT handler
    plugins/
      di.plugin.ts                             @fastify/awilix bridge
      request-context.plugin.ts                @fastify/request-context
      health.plugin.ts                         GET /health
      swagger.plugin.ts                        @fastify/swagger + UI
      error-handler.plugin.ts                  minimal handler (replaced by @kit/errors later)
```

## Core ideas

- **Convention over configuration.** Files in your service that match
  `*.{repository,service,mapper,client}.{ts,js}` are auto-registered in the
  Awilix container as singletons. The cradle key is the camelCased filename:
  `users.repository.ts` -> `usersRepository`,
  `merchant-mids.repository.ts` -> `merchantMidsRepository`.
- **Function factories, not classes.** Services are plain functions that
  destructure their dependencies. No decorators, no metadata reflection.
- **Global `Dependencies` interface.** Each module augments it via
  `declare global { interface Dependencies { ... } }`. The result is a
  living, type-checked index of every service in the app.
- **Security on by default.** `createServer` registers `@fastify/helmet`,
  `@fastify/cors`, and `@fastify/rate-limit` out of the box. Override with
  options or pass `false` only when you have an equivalent upstream layer.

## Quick start

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
  DATABASE_URL: z.string().url(),
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

## Adding a service (the convention)

```ts
// modules/users/users.service.ts
export const createUsersService = ({
  usersRepository,
  logger,
}: Pick<Dependencies, 'usersRepository' | 'logger'>) => ({
  async getById(id: string) {
    logger.debug({ id }, 'fetching user');
    return usersRepository.findByIdOrThrow(id);
  },
});

declare global {
  interface Dependencies {
    usersService: ReturnType<typeof createUsersService>;
  }
}
```

That's it -- no `container.register(...)`, no manual wiring. The file is
picked up by `modulesGlobs` and registered as `usersService` automatically.

## Config

`createConfig` parses `process.env` through a zod schema. The base schema
provides `LOG_LEVEL`, `ENVIRONMENT`, `APP_NAME`, `APP_VERSION`, `HOST`,
`PORT`, plus convenience flags `isDev`, `isProd`, `isTest`. Extend it by
passing extra zod fields:

```ts
const config = createConfig({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
});
```

## What this package deliberately does NOT do

- **No HTTP exception classes.** That belongs to `@kit/errors`.
- **No database/ORM setup.** That belongs to `@kit/db`.
- **No auth/authz.** That belongs to `@kit/auth` and `@kit/authz`.
- **No business modules.** Those live in `services/api/src/modules/`.

`@kit/core` is intentionally the smallest possible runtime spine. Everything
else plugs into it via the DI container or Fastify plugin system.
