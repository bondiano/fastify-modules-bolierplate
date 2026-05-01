# @kit/authz

CASL-backed authorization for the Fastify SaaS Kit. Provides an ability
factory built from per-module definers, an `admin`-role override, and a
Fastify plugin exposing `fastify.authorize(action, subject)` for route
guards.

## Directory

```
src/
  errors.ts     AuthzError + 401/403 subclasses
  ability.ts    createAbilityFactory + AuthzAction/Subject/User types
  plugin.ts     Fastify plugin: request.ability + fastify.authorize
```

## Key ideas

- **Module definers, central factory.** Each business module exports a
  `DefineAbilities` function (`(user, builder) => void`). The app collects
  them and passes the list to `createAbilityFactory({ definers })`. The
  factory is a DI singleton; abilities are built per-request inside
  `authorize`.
- **Admin override is built in.** Users whose `role === 'admin'` get
  `manage all` before module definers run, so module code never has to
  remember the override. Pass `adminRole: null` to disable.
- **No coupling to @kit/auth.** The plugin reads the caller from
  `request.auth` by default (the shape `verifyJwt` populates) but accepts a
  `getUser` override so it works with any auth strategy.
- **No coupling to @kit/errors.** Errors carry `statusCode` + `error` name
  matching the kit's global handler shape.
- **Lazy ability build.** `request.ability` is only constructed the first
  time `authorize` runs on a request, so unauthenticated routes pay nothing.
- **Optional tenant-level membership.** Definers receive a third argument
  `membership?: AuthzMembership` (`{ tenantId, role }`). Single-tenant apps
  leave it `undefined`. Multi-tenant apps populate `request.membership`
  before `authorize` runs (typically via a preHandler that pairs
  `request.tenant` with the user's row from `membershipsRepository`); the
  plugin reads it via `getMembership` (overridable). The type lives in
  `@kit/authz` so authz never imports `@kit/tenancy`.

## Wiring sketch (in services/api)

Use `authzProvider` to register the ability factory in the DI container,
then register the Fastify plugin via the `plugins` array on `createServer`.

```ts
// main.ts
import { authzProvider } from '@kit/authz/provider';
import { createContainer } from '@kit/core/di';
import { definePostAbilities } from '#modules/posts/posts.abilities.ts';
import { defineUserAbilities } from '#modules/users/users.abilities.ts';

const container = await createContainer({
  logger, config,
  modulesGlobs: [...],
  providers: [
    authzProvider({
      definers: [defineUserAbilities, definePostAbilities],
    }),
    // ...other providers
  ],
});

// server/create.ts -- register the plugin inline (after createAuthPlugin):
import { createAuthzPlugin } from '@kit/authz/plugin';

await createKitServer({
  config, container, logger,
  plugins: [
    createAuthPlugin,
    createAuthzPlugin,
    // ...
  ],
});
```

Module-level Dependencies augmentation lives once in your app
(e.g. `modules/init.ts`):

```ts
declare global {
  interface Dependencies {
    abilityDefiners: readonly DefineAbilities[];
    abilityFactory: AbilityFactory;
  }
}
```

## Defining module abilities

```ts
// modules/posts/posts.abilities.ts
import type { DefineAbilities } from '@kit/authz';

export const definePostAbilities: DefineAbilities = (user, builder) => {
  builder.can('read', 'Post');
  builder.can(['create', 'update', 'delete'], 'Post', { authorId: user.id });
};
```

Definers are **additive only** -- they grant, never revoke. To deny
something, simply don't grant it.

### Tenant-level role rules

When the consuming app populates `request.membership`, the same definer
can branch on the user's role *within the active tenant*:

```ts
import type { DefineAbilities } from '@kit/authz';

export const defineInvitationAbilities: DefineAbilities = (
  _user,
  builder,
  membership,
) => {
  // Single-tenant calls (no membership) silently no-op -- definers must
  // tolerate `undefined` rather than throwing.
  if (!membership) return;
  if (membership.role === 'owner' || membership.role === 'admin') {
    builder.can('create', 'Invitation');
  }
};
```

Wiring `request.membership` lives in the consuming app (kept out of
`@kit/authz` to avoid pulling in `@kit/tenancy`):

```ts
// services/api/src/server/plugins/membership.ts
fastify.addHook('preHandler', async (request) => {
  if (!request.tenant || !request.auth) return;
  const row = await membershipsRepository.findByUserIdInCurrentTenant(
    request.auth.sub,
  );
  if (row) {
    request.membership = { tenantId: row.tenantId, role: row.role };
  }
});
```

Register this hook *before* `createAuthzPlugin` (or any route that calls
`fastify.authorize`).

## Guarding routes

```ts
fastify.route({
  method: 'DELETE',
  url: '/posts/:id',
  onRequest: [fastify.verifyUser],
  preHandler: [
    fastify.authorize('delete', 'Post', async (request) => {
      const { id } = request.params as { id: string };
      return postsRepository.findById(id); // returns { __typename: 'Post', authorId, ... }
    }),
  ],
  handler: async (request) =>
    postsService.delete((request.params as { id: string }).id),
});
```

For coarse class-level checks, drop the resolver and pass the subject tag:

```ts
preHandler: [fastify.authorize('create', 'Post')],
```

The hook throws `UnauthorizedError` (401) when no caller is on the request,
`ForbiddenError` (403) when the rule fails -- both are mapped by the global
error handler.

## Extending the action vocabulary

The default actions are `manage | create | read | update | delete`. To add
domain verbs (`publish`, `approve`), augment the type in your app:

```ts
declare module '@kit/authz' {
  type AuthzAction =
    | 'manage'
    | 'create'
    | 'read'
    | 'update'
    | 'delete'
    | 'publish';
}
```
