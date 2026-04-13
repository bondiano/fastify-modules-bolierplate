# @kit/auth

Fully stateless JWT authentication for the Fastify SaaS Kit. Both access and
refresh tokens are HS256 JWTs (jose). Revocation is handled via a Redis
blacklist -- no DB tables for tokens.

Provides password hashing (argon2id), token service, auth service
(register/login/refresh/logout/clear-sessions), TypeBox schemas, and a
Fastify plugin with `verifyJwt`/`verifyUser`/`verifyAdmin` decorators that
check the blacklist on every request.

## Directory

```
src/
  config.ts         authConfigSchema (JWT_SECRET, ISSUER, TTLs)
  errors.ts         AuthError + 401/403/409 subclasses
  password.ts       createPasswordHasher (argon2id, OWASP defaults)
  tokens.ts         createTokenService (sign/verify for both access + refresh JWTs)
  stores.ts         UserStore + TokenBlacklistStore interfaces
  auth.service.ts   createAuthService (register/login/refresh/logout/clearSessions)
  schemas.ts        TypeBox schemas for auth routes
  plugin.ts         Fastify plugin: verifyJwt/verifyUser/verifyAdmin (with blacklist check)
```

## Key ideas

- **Fully stateless JWTs.** Both access and refresh tokens are HS256 JWTs.
  No database tables for tokens. Access tokens are short-lived (15m default),
  refresh tokens are long-lived (14d default).
- **Redis blacklist for revocation.** `logout` blacklists a single refresh
  token's `jti`. `clearSessions` sets a per-user `clearedAt` timestamp -- any
  token with `iat < clearedAt` is rejected. Blacklist keys have TTL =
  refresh token TTL + 6 hours, so they auto-expire.
- **Blacklist checked on every `verifyJwt`.** The plugin checks both the
  per-token blacklist and the per-user `clearedAt` before accepting a token.
- **No ORM coupling.** This package depends on `UserStore` and
  `TokenBlacklistStore` interfaces. The consuming service implements them
  (UserStore via `@kit/db`, TokenBlacklistStore via Redis).
- **No `@kit/errors` coupling.** Errors carry `statusCode` + `error` name
  matching the kit's global handler shape.
- **Password verify is constant-effort.** `login` runs argon2 verify even
  on missing users to keep timing roughly even.

## Wiring sketch (in services/api)

Use `authProvider` to register all auth services in the DI container, then
register the Fastify plugin via the `plugins` array on `createServer`.

```ts
// main.ts
import { Redis } from 'ioredis';
import { authProvider } from '@kit/auth/provider';
import { createContainer } from '@kit/core/di';
import { createTokenBlacklistService } from '#modules/auth/token-blacklist.service.ts';

const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const container = await createContainer({
  logger, config,
  extraValues: { redis, /* dataSource, transactionStorage */ },
  modulesGlobs: [...],
  providers: [
    authProvider({
      resolveUserStore: ({ usersRepository }) => usersRepository.asUserStore(),
      resolveTokenBlacklistStore: ({ redis }) => createTokenBlacklistService({ redis }),
    }),
    // ...other providers
  ],
});

// server/create.ts -- register the plugin inline:
import { createAuthPlugin } from '@kit/auth/plugin';

await createKitServer({
  config, container, logger,
  plugins: [createAuthPlugin /* ...other kit plugins */],
});
```

The provider auto-registers `passwordHasher`, `tokenService`, `userStore`,
`tokenBlacklistStore`, and `authService` as singletons. Awilix resolves their
dependencies (`config`, etc.) from the cradle.

## Auth routes

| Method | URL                  | Auth   | Description                                        |
| ------ | -------------------- | ------ | -------------------------------------------------- |
| POST   | /auth/register       | --     | Create account, return tokens                      |
| POST   | /auth/login          | --     | Authenticate, return tokens                        |
| POST   | /auth/refresh        | --     | Exchange refresh token for new pair                |
| POST   | /auth/logout         | --     | Blacklist refresh token (body: `{ refreshToken }`) |
| POST   | /auth/clear-sessions | Bearer | Invalidate all tokens for current user             |

## Adding a protected route

```ts
fastify.route({
  method: 'GET',
  url: '/me',
  onRequest: [fastify.verifyUser],
  handler: async (request) => {
    const { sub, role } = request.auth!;
    return { id: sub, role };
  },
});
```

For admin-only routes use `fastify.verifyAdmin`.

## Config

| Var                 | Default            | Notes                                       |
| ------------------- | ------------------ | ------------------------------------------- |
| `JWT_SECRET`        | --                 | Required, min 32 chars                      |
| `JWT_ISSUER`        | `fastify-saas-kit` | Stamped on every token                      |
| `ACCESS_TOKEN_TTL`  | `15m`              | jose `setExpirationTime` format             |
| `REFRESH_TOKEN_TTL` | `14d`              | Also used for blacklist key TTL + 6h buffer |

## Error mapping

| Error                     | Status |
| ------------------------- | ------ |
| `InvalidCredentialsError` | 401    |
| `InvalidTokenError`       | 401    |
| `ExpiredTokenError`       | 401    |
| `TokenRevokedError`       | 401    |
| `UnauthorizedError`       | 401    |
| `ForbiddenError`          | 403    |
| `UserAlreadyExistsError`  | 409    |
