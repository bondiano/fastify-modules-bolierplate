# @kit/errors

Structured exception hierarchy + tagged domain errors for the Fastify SaaS
Kit. Supports two error-handling styles backed by the same Fastify handler:

1. **Throw exceptions** anywhere. Caught by the global error handler and
   serialized to a consistent JSON response.
2. **Return tagged `DomainError`s** from services (railway style). Match on
   `_tag` with `ts-pattern` or any discriminated-union pattern your codebase
   uses. Escaped domain errors are also mapped through the same handler via
   `DomainError.toException()`.

For the `Effect`-returning style (Fastify route wrapper that runs an
`Effect` and maps failures into this pipeline) see **`@kit/effect-ts`**.
It's a separate package so consumers without effect-ts don't pay for it.

## Directory

```
src/
  exception-base.ts   ExceptionBase + EXCEPTION_BASE_TAG + isExceptionBase
  exceptions.ts       BadRequest/Unauthorized/Forbidden/NotFound/Conflict/
                      UnprocessableEntity/TooManyRequests/InternalServerError
  domain-error.ts     DomainError base + defineDomainError factory + isDomainError
  handler.ts          createErrorHandler -- the setErrorHandler callback
  plugin.ts           createErrorHandlerPlugin (fastify-plugin wrapper)
```

## Exception hierarchy

Every exception extends `ExceptionBase` and carries `statusCode` + `error` so
the handler can serialize without knowing subclasses. Matches PRD §5.5:

| Exception                      | Status | Use case                   |
| ------------------------------ | ------ | -------------------------- |
| `BadRequestException`          | 400    | Invalid input              |
| `UnauthorizedException`        | 401    | Missing / invalid auth     |
| `ForbiddenException`           | 403    | Insufficient permissions   |
| `NotFoundException`            | 404    | Resource not found         |
| `ConflictException`            | 409    | Duplicate / state conflict |
| `UnprocessableEntityException` | 422    | Business rule violation    |
| `TooManyRequestsException`     | 429    | Rate limit exceeded        |
| `InternalServerErrorException` | 500    | Catch-all                  |

## Style A -- throw

```ts
import { NotFoundException } from '@kit/errors';

export const usersService = ({ usersRepository }: Dependencies) => ({
  async findById(id: string) {
    const user = await usersRepository.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  },
});
```

## Style B -- tagged domain errors (railway)

Each domain error lives next to its module and uses `defineDomainError` to
get a stable `_tag` + a default exception mapping:

```ts
// modules/users/errors/user-not-found.error.ts
import { defineDomainError, NotFoundException } from '@kit/errors';

export class UserNotFound extends defineDomainError(
  'UserNotFound',
  NotFoundException,
) {
  constructor(public readonly userId: string) {
    super(`User ${userId} not found`);
  }
}
```

Services return a union of domain errors (use any `Result` type you like --
`neverthrow`, a hand-rolled tagged union, `Effect`, etc.). At the route
boundary you can either:

- **Match and respond manually.** Discriminate on `_tag` with `ts-pattern`:

  ```ts
  import { match } from 'ts-pattern';

  const result = await usersService.findById(req.params.id);
  if (result.ok) return result.value;
  return match(result.error)
    .with({ _tag: 'UserNotFound' }, (e) =>
      reply.code(404).send({ message: e.message }),
    )
    .exhaustive();
  ```

- **Throw and let the handler map it.** Every `DomainError` has
  `.toException()`, and the global handler also recognizes escaped domain
  errors directly:
  ```ts
  if (!result.ok) throw result.error; // handler calls .toException() under the hood
  ```

## Wiring (services/api)

```ts
// services/api/src/server/plugins/error-handler.ts
import { createErrorHandlerPlugin } from '@kit/errors';
import { NoResultError } from 'kysely';

export default createErrorHandlerPlugin;
export const autoConfig = {
  getCorrelationId: (req) => req.id,
  exposeStack: process.env.NODE_ENV !== 'production',
  // Translate library errors the kit doesn't import directly.
  mapUnknown: (error: unknown) => {
    if (error instanceof NoResultError) {
      return {
        statusCode: 404,
        error: 'Not Found',
        message: 'No result found',
      };
    }
    return undefined;
  },
};
```

## Response shape

All error responses are wrapped in the `{ data, error }` envelope:

```json
{
  "data": null,
  "error": {
    "statusCode": 404,
    "error": "Not Found",
    "message": "User 42 not found",
    "correlationId": "req-abc"
  }
}
```

Validation failures additionally carry `subErrors: [{ path, message }]`
inside the `error` object. This matches `apiErrorEnvelopeSchema` from
`@kit/schemas`.

## Error monitoring (Sentry, Datadog, Better Stack, ...)

The kit does not ship a Sentry (or any other APM) integration. Two zero-code
paths already cover the MVP:

### Path A -- pino transport (recommended)

`createErrorHandler` logs every unhandled 5xx via
`request.log.error({ err, correlationId }, 'Unhandled request error')`. Any
pino-compatible transport can pick that up and forward to your monitoring
backend:

```ts
// services/api/src/config.ts (excerpt)
const transport =
  process.env.NODE_ENV === 'production'
    ? {
        targets: [
          { target: 'pino/file', options: { destination: 1 } },
          {
            target: '@sentry/pino-transport',
            level: 'error',
            options: {
              dsn: process.env.SENTRY_DSN,
              environment: process.env.APP_ENV,
            },
          },
        ],
      }
    : undefined;

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  transport,
);
```

Because the handler enriches the log with `err` and `correlationId`, Sentry
events get a stack trace and a request id automatically. Nothing inside
`@kit/*` needs to change -- swap transports per deployment.

### Path B -- Fastify `onError` hook

If you need to tag spans, attach user context, or filter by status code
before reporting, add a hook in your app (not the kit):

```ts
// services/api/src/server/plugins/sentry.ts
import * as Sentry from '@sentry/node';
import fp from 'fastify-plugin';

export default fp(async (fastify) => {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });

  fastify.addHook('onRequest', async (req) => {
    Sentry.getCurrentScope().setTag('correlationId', req.id);
  });

  fastify.addHook('onError', async (req, _reply, error) => {
    if (
      (error as { statusCode?: number }).statusCode &&
      (error as { statusCode: number }).statusCode < 500
    )
      return;
    Sentry.captureException(error, {
      tags: { route: req.routeOptions?.url, method: req.method },
    });
  });
});
```

Fastify invokes `onError` hooks **before** `setErrorHandler`, so Sentry sees
the raw error object -- including `DomainError` instances and
`ExceptionBase` subclasses -- before the kit translates them into the
`{ data, error }` envelope.

### Why no `@kit/sentry` package

- **Clone-and-own**: the recipe is short enough that copying it into your
  app is clearer than hiding it behind a plugin factory.
- **Vendor-neutral**: the same two paths work for Datadog, New Relic,
  Honeycomb, Axiom, Better Stack -- the kit doesn't need to pick one.
- **No extra deps in the hot path**: `@kit/errors` stays dependency-free.

## Conventions

- Domain errors live next to the module that owns them:
  `modules/<name>/errors/<thing>.error.ts`.
- Use `defineDomainError('TagName', SomeException)` so each has a stable
  `_tag` for pattern matching _and_ a default HTTP mapping.
- No coupling to a specific `Result` library -- domain errors are plain
  tagged classes, usable from any style.
- For effect-ts integration, install `@kit/effect-ts` and use its
  `effectHandler`.
