# @kit/config

Typed, validated configuration loaded from environment variables. Zod-based
schemas, cascading `.env` file discovery, and a single merged `config` object
consumed everywhere via DI.

## Directory

```
src/
  create-config.ts       createConfig, baseConfigSchema, Environment, port, InferConfig
  load-env.ts            loadEnvironmentFiles (cascading .env loader)
  parse-env.ts           parseEnv + EnvValidationError (aggregated error messages)
  find-workspace-root.ts findWorkspaceRoot (walks up to pnpm-workspace.yaml)
  index.ts               Public re-exports
```

## Key ideas

- **Schema layering.** Each `@kit/*` package that needs env vars exports a
  `<name>ConfigSchema` fragment (a plain Zod schema record). The service
  composes them via spread: `createConfig({ ...dbConfigSchema, ...authConfigSchema, ...moduleSchema })`.
  The `baseConfigSchema` (env, host, port, log level, app name/version) is
  merged automatically.
- **Environment cascade.** `loadEnvironmentFiles(basePath)` loads four files
  in order -- last loaded wins (Node's `loadEnvFile` sets only missing keys
  so earlier files effectively win per key):

  ```
  .env.{ENVIRONMENT}.local   # per-dev overrides, git-ignored
  .env.{ENVIRONMENT}         # committed env-specific defaults
  .env.local                 # shared local overrides, git-ignored
  .env                       # committed shared defaults
  ```

  `ENVIRONMENT` is read from `process.env.ENVIRONMENT` before schema parsing,
  defaulting to `development`.

- **Validated once at startup.** `parseEnv` collects every Zod error and
  throws a single `EnvValidationError` with a multi-line message. No silent
  fallbacks -- a missing `DATABASE_URL` crashes the process before the
  container is built.
- **Zero DI coupling.** `@kit/config` does not register anything in Awilix.
  The returned `config` object is passed into `createContainer({ config })`
  by the service bootstrap.

## Usage sketch

```ts
// services/api/src/config.ts
import { authConfigSchema } from '@kit/auth/config';
import { createConfig, findWorkspaceRoot, z } from '@kit/config';
import { dbConfigSchema } from '@kit/db/config';
import { jobsConfigSchema } from '@kit/jobs/config';

export const config = createConfig(
  {
    ...dbConfigSchema,
    ...authConfigSchema,
    ...jobsConfigSchema,
    CORS_ORIGINS: z.string().default('*'),
  },
  { envPath: findWorkspaceRoot(import.meta.dirname) },
);

export type AppConfig = typeof config;
```

`config` is the `BaseConfig & DbConfig & AuthConfig & JobsConfig & { CORS_ORIGINS }`
intersection plus the `isDev` / `isTest` / `isStaging` / `isProd` helpers.

## Base schema

Every config automatically includes (with defaults applied when unset):

| Variable      | Type                                               | Default            |
| ------------- | -------------------------------------------------- | ------------------ |
| `ENVIRONMENT` | `development \| test \| staging \| production`     | `development`      |
| `LOG_LEVEL`   | `trace \| debug \| info \| warn \| error \| fatal \| silent` | `info` |
| `HOST`        | `string`                                           | `0.0.0.0`          |
| `PORT`        | `number` (1-65535)                                 | `3000`             |
| `APP_NAME`    | `string`                                           | `fastify-saas-kit` |
| `APP_VERSION` | `string`                                           | `0.0.0`            |

Plus computed booleans: `isDev`, `isTest`, `isStaging`, `isProd`.

## Adding a config schema to a kit package

1. Create `src/config.ts` in the package exporting a plain record of Zod
   schemas -- **not** a `z.object`:

   ```ts
   // packages/kit/mailer/src/config.ts
   import { z } from 'zod';

   export const mailerConfigSchema = {
     SMTP_URL: z.string().url(),
     SMTP_FROM: z.string().email(),
     MAIL_PROVIDER: z.enum(['smtp', 'postmark', 'ses']).default('smtp'),
   };

   export type MailerConfig = {
     SMTP_URL: string;
     SMTP_FROM: string;
     MAIL_PROVIDER: 'smtp' | 'postmark' | 'ses';
   };
   ```

2. Expose it via the package's `exports` map so consumers can import
   `@kit/mailer/config` without pulling runtime code:

   ```jsonc
   // packages/kit/mailer/package.json
   "exports": {
     ".": "./dist/index.js",
     "./config": "./dist/config.js"
   }
   ```

3. Service composes it with the others:

   ```ts
   createConfig({ ...dbConfigSchema, ...mailerConfigSchema });
   ```

## Adding a module-local config schema

Business modules inside `services/api/src/modules/<name>/` that need their
own env vars follow the same pattern -- export a schema record from
`<name>.config.ts`, spread it into `createConfig(...)`. Don't call
`createConfig` twice; there is a single app config.

## Naming conventions

- **Keys are `SCREAMING_SNAKE_CASE`** -- they map 1:1 to env var names.
- **Prefix with the subsystem**: `DATABASE_*`, `REDIS_*`, `SMTP_*`,
  `JWT_*`. Keeps `.env` files readable and makes origin obvious.
- **Typed via `z.coerce.*` for numbers/booleans** -- env values are always
  strings. `port()` is a pre-made helper for TCP port validation.
- **Default only what's truly optional.** If a secret has no sensible
  default (JWT_SECRET, DATABASE_URL), do not `.default()` -- let startup
  crash with a clear error.

## Testing

Pass `options.env` to bypass `.env` file loading and inject values directly:

```ts
const config = createConfig(
  { DATABASE_URL: z.string() },
  { env: { DATABASE_URL: 'postgres://localhost/test_db', ENVIRONMENT: 'test' } },
);
```

This is what `@kit/test` uses internally to build isolated test containers.

## Gotchas

- **`envPath` vs `env`**: when `env` is provided, file loading is skipped --
  `options.env` is authoritative. Use this for tests and programmatic boot.
- **Workspace root**: `findWorkspaceRoot(import.meta.dirname)` walks up
  looking for `pnpm-workspace.yaml`. In a service it finds the monorepo
  root so all services share the same `.env`. If you copy the service out
  of the monorepo, replace with `import.meta.dirname` or an explicit path.
- **ENVIRONMENT is read twice**: once by `loadEnvironmentFiles` (to pick
  the file cascade) and once by the schema (to populate `config.ENVIRONMENT`).
  If you override `ENVIRONMENT` inside a `.env` file, the file cascade is
  already decided -- the override only affects the parsed config value.
- **Do not store derived objects in config.** Keep `config` a flat record of
  primitives. Build clients / pools / connections from the config in their
  factory, not in `config.ts`.
