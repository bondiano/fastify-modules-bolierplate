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
| `InvalidTokenFlowError`   | 401    |
| `EmailNotVerifiedError`   | 403    |
| `OtpLockedOutError`       | 429    |

## Token-based flows (password reset / email verification / OTP)

The auth service ships three token-driven flows on top of the
session-token primitives. Each follows the same shape:

1. A request endpoint persists `sha256(token)` in a DB-backed store and
   fires a typed mailer event (callback) with the raw token. Real
   delivery lands in `P2.mailer.*`; for now consumers wire a stub
   handler that renders + logs.
2. A confirm endpoint hashes the incoming token, looks up the row, and
   atomically marks it used. Failures (no row / expired / used) all
   collapse into `InvalidTokenFlowError` so the response shape doesn't
   leak which step blocked it.

| Flow              | Request endpoint                      | Confirm endpoint                       | TTL (default) |
| ----------------- | ------------------------------------- | -------------------------------------- | ------------- |
| Password reset    | `POST /auth/password-reset/request`   | `POST /auth/password-reset/confirm`    | 60 min        |
| Email verify      | `POST /auth/email-verification/request` | `POST /auth/email-verification/confirm` | 24 h          |
| OTP (MFA)         | `POST /auth/otp/request`              | `POST /auth/otp/verify`                | 5 min, max 5 attempts |

### Stores

`@kit/auth/stores` declares three additional interfaces -- the consumer
service implements each against its own DB (the boilerplate uses
Kysely-backed repositories under
`services/api/src/modules/auth/{password-reset-token,email-verification-token,otp-code}.repository.ts`):

- `PasswordResetTokenStore` -- `create / findByTokenHash / markUsed /
pruneExpired`. `markUsed` returns `false` when the row has already
  been redeemed.
- `EmailVerificationTokenStore` -- mirrors the above but with
  `findByTokenHash` returning the email snapshot too (replay safety on
  email rotation) and `markVerified`.
- `OtpCodeStore` -- adds `findActive({ userId, purpose })`,
  `incrementAttempts(id)` (atomic, returns the new count), and
  `markUsed(id)`.

### Mailer events

`AuthProviderOptions` accepts three optional callbacks fired AFTER the
matching DB row commits:

- `onPasswordResetRequested(event)` -- `{ userId, email, token, expiresAt }`
- `onEmailVerificationRequested(event)` -- same shape
- `onOtpRequested(event)` -- `{ userId, email, purpose, code, expiresAt }`

Each ships with a pure renderer at `@kit/auth/templates/<flow>` that
returns a `KitMailMessage` (`{ to, subject, text, html }`). The `services/api`
boilerplate wires the renderers to `logger.info(...)` stubs in
`bin/server.ts`; swap to a real mailer adapter once `P2.mailer.*` lands.

### `requireVerifiedEmail` decorator

`fastify.requireVerifiedEmail` wraps `verifyJwt` and additionally
checks `users.email_verified_at`. Use it on routes that demand a real
email (e.g. billing checkout, GDPR data exports). Returns
`EmailNotVerifiedError` (403, code `EmailNotVerifiedError`) when the
flag is `null`.

```ts
fastify.route({
  method: 'POST',
  url: '/billing/checkout',
  onRequest: [fastify.requireVerifiedEmail],
  handler: ...,
});
```

### Security notes

- **Enumeration safety.** `requestPasswordReset` always resolves
  silently when the email is unknown -- the route returns 204
  unconditionally. Pair with route-level rate limiting (5/min/IP for
  password reset, 3/min for OTP request).
- **Timing.** Token comparison uses `compareTokens` (`crypto.timingSafeEqual`
  for equal-length strings); raw tokens never reach the DB so the
  comparison is `hash(input) === stored_hash`, also constant-effort.
- **OTP lockout.** `verifyOtp` increments attempts BEFORE comparing the
  hash, so a slow comparator cannot be replayed for free. Once the
  count crosses `OTP_MAX_ATTEMPTS`, the row is marked used and any
  further verify attempts hit `InvalidTokenFlowError` until a fresh
  `requestOtp` lands.
- **Session-clear on reset.** `confirmPasswordReset` runs
  `clearSessions(userId)` so a stolen access token cannot keep the
  account alive after the legitimate user resets.

### Adding a new token-based flow

1. Add a migration for the storage table (`{flow}_tokens`).
2. Declare a `Store` interface in your service module mirroring
   `PasswordResetTokenStore`.
3. Implement it as a Kysely repository under
   `modules/<flow>/<flow>-token.repository.ts`.
4. Extend `AuthService` with the request/confirm methods (or write a
   sibling service if the flow doesn't fit the auth surface).
5. Add a `request.audit(...)` emission for both endpoints.
