# @kit/effect-ts

Effect-ts integration for Fastify routes that bridges typed `Effect` failures
into the `@kit/errors` exception pipeline.

## Directory

```
src/
  run.ts       toException + runEffect (Effect -> Promise<A>, throws ExceptionBase)
  handler.ts   effectHandler -- Fastify route wrapper
```

## Why a separate package

`effect` is a heavy peer dep with its own runtime. Services that don't use
the Effect style shouldn't pay for it -- so this lives outside `@kit/errors`
and only consumers that opt in install it.

## Usage

```ts
import { Effect } from 'effect';
import { effectHandler } from '@kit/effect-ts';
import { defineDomainError, NotFoundException } from '@kit/errors';

export class UserNotFound extends defineDomainError(
  'UserNotFound',
  NotFoundException,
) {
  constructor(public readonly userId: string) {
    super(`User ${userId} not found`);
  }
}

const findById = (id: string) =>
  Effect.tryPromise(() => usersRepository.findById(id)).pipe(
    Effect.flatMap((u) =>
      u ? Effect.succeed(u) : Effect.fail(new UserNotFound(id)),
    ),
  );

fastify.get(
  '/users/:id',
  effectHandler((req) => findById(req.params.id)),
);
```

`effectHandler` runs the effect; on `Fail` the typed value goes through the
same mapping as a thrown error (`DomainError.toException()`, `ExceptionBase`
passthrough, otherwise wrapped as 500). On `Die` (defect / interrupt) it
becomes a 500. Either way, the kit's `setErrorHandler` from `@kit/errors`
serializes the response.

## Style coexistence

The same service can mix styles freely: throw exceptions in some methods,
return `Effect` from others. Routes use `effectHandler` for effectful methods
and plain async handlers for the rest -- a single Fastify error handler
covers both.
