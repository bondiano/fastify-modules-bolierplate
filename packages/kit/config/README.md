# @kit/config

Typed, validated configuration from environment variables with cascading `.env` file support.

Built on [Zod](https://zod.dev) for schema validation and Node.js native `loadEnvFile()` for `.env` loading. Zero extra dependencies beyond Zod.

## Usage

```ts
import { createConfig, findWorkspaceRoot, z, port } from '@kit/config';

const config = createConfig(
  {
    DATABASE_URL: z.string(),
    REDIS_URL: z.string(),
    CORS_ORIGINS: z.string().transform((v) => v.split(',')),
    WORKER_CONCURRENCY: z.coerce.number().default(5),
  },
  { envPath: findWorkspaceRoot(import.meta.dirname) },
);

config.DATABASE_URL; // string (validated)
config.PORT; // number (from base schema)
config.isDev; // boolean helper
```

## Base Schema

Every config automatically includes these fields (with defaults):

| Variable      | Type                                                         | Default            |
| ------------- | ------------------------------------------------------------ | ------------------ |
| `ENVIRONMENT` | `development \| test \| staging \| production`               | `development`      |
| `LOG_LEVEL`   | `trace \| debug \| info \| warn \| error \| fatal \| silent` | `info`             |
| `HOST`        | `string`                                                     | `0.0.0.0`          |
| `PORT`        | `number` (valid port)                                        | `3000`             |
| `APP_NAME`    | `string`                                                     | `fastify-saas-kit` |
| `APP_VERSION` | `string`                                                     | `0.0.0`            |

Plus computed helpers: `isDev`, `isTest`, `isStaging`, `isProd`.

## .env File Loading

When `envPath` is provided, files are loaded in cascading order (first match wins):

```
.env.{ENVIRONMENT}.local   # local overrides, git-ignored
.env.{ENVIRONMENT}         # environment-specific
.env.local                 # shared local overrides, git-ignored
.env                       # shared defaults
```

Uses Node.js built-in `loadEnvFile()` (Node 22+). Missing files are silently skipped.

## Testing

Pass `env` to bypass file loading and inject values directly:

```ts
const config = createConfig(
  { DATABASE_URL: z.string() },
  { env: { DATABASE_URL: 'postgres://localhost/test_db' } },
);
```

## API

### `createConfig(extraSchema?, options?)`

Creates a validated config by merging `baseConfigSchema` with your schema.

- **`extraSchema`** -- Record of Zod schemas for app-specific variables
- **`options.envPath`** -- Directory with `.env` files (triggers file loading)
- **`options.env`** -- Explicit env record (skips file loading, useful for tests)

### `findWorkspaceRoot(startDir)`

Walks up from `startDir` until a directory containing `pnpm-workspace.yaml` is found. Returns the absolute path to the workspace root. Throws if the filesystem root is reached without finding it.

### `loadEnvironmentFiles(basePath)`

Standalone `.env` loader. Returns list of loaded file paths. Use when you need to load env files without config validation.

### `parseEnv(env, schema)`

Low-level env parser. Validates a `Record<string, string | undefined>` against a Zod schema record. Collects all errors and throws once with a descriptive message. Used internally by `createConfig`.

### `port()`

Zod schema for a valid TCP/UDP port (1-65535). Coerces strings to numbers.

### Re-exports

`z` from `zod` is re-exported for convenience.
