# @kit/admin

Django-admin-style admin panel that lives **inside** the Fastify API
process as a kit plugin. Walks the Awilix DI cradle for repositories,
derives columns/types/constraints from Postgres `information_schema` at
boot, and renders HTML fragments over htmx.

Zero per-module boilerplate for the common case: a new migration +
repository gives you a working CRUD admin page automatically.

## Directory

```
src/
  types.ts                 Shared type contracts (ColumnMeta, AdminResourceSpec, ...)
  plugin.ts                createAdminPlugin Fastify plugin factory
  define-resource.ts       defineAdminResource() function (override layer)
  safe-url.ts              URL allow-list helper (blocks javascript: etc.)
  render.ts                html + renderPage/renderFragment wrappers
  schema/
    queries.ts             SQL for information_schema snapshot
    registry.ts            createSchemaRegistry (boot-time query)
    autogen-validators.ts  TableMeta -> TypeBox create/update schemas
  discovery/
    walk-cradle.ts         Find AdminDiscoverable repos in cradle
    infer-spec.ts          TableMeta + repository -> AdminResourceSpec
    infer-widget.ts        ColumnMeta -> WidgetKind
    merge-overrides.ts     Inferred spec + override -> final spec
  runtime/
    auto-loader.ts         Glob modules/**/*.admin.ts
    registry.ts            In-process AdminRegistry
    csrf.ts                Per-form signed token
  routes/
    dashboard.route.ts     GET /admin
    login.route.ts         GET/POST /admin/login, POST /admin/logout
    list.route.ts          GET /admin/:resource
    detail.route.ts        GET /admin/:resource/:id
    create.route.ts        GET /new + POST /admin/:resource
    update.route.ts        PATCH /admin/:resource/:id
    delete.route.ts        DELETE /admin/:resource/:id + bulk-delete
    relations.route.ts     GET /admin/:resource/_relations/:col
    assets.route.ts        GET /admin/_assets/htmx.min.js + admin.css
  views/
    layout.ts              Page chrome + vendored htmx + CSRF meta
    data-table.ts          Paginated list view
    form.ts                Generic form renderer
    icons.ts               Inline SVG icons
    widgets/               text, textarea, select, checkbox, ...
  assets/
    htmx.min.js            Vendored htmx bundle
    admin.css              Hand-rolled CSS
```

## Key ideas

- **Source of truth is Postgres.** `information_schema` + `pg_catalog`
  drive columns, types, nullability, enums, and FKs. No TypeBox /
  schema.ts duplication, no drift possible.
- **Repositories auto-discovered.** Anything in `container.cradle` with a
  `readonly table: string` and the five standard CRUD methods becomes a
  resource. Zero boilerplate per module.
- **htmx over the wire.** Every request returns HTML. No SPA bundler, no
  hydration. `--experimental-strip-types` compatible because we use
  `htm/preact` tagged templates, not JSX.
- **Multi-instance safe.** Every admin request is a stateless HTTP call.
  SSE live views are deferred to dedicated sticky routes.
- **Overrides are functions.** `defineAdminResource('posts', async ({
cradle, registry }) => ({...}))` can reach into DI at boot time to
  fetch relation options, dynamic permissions, etc.

## Wiring (in services/api)

```ts
// services/api/src/server/create.ts
import { createAdminPlugin } from '@kit/admin/plugin';

return createKitServer({
  // ...
  plugins: [
    createErrorHandlerPlugin,
    createAuthPlugin,
    createAuthzPlugin,
    {
      plugin: createAdminPlugin,
      options: {
        prefix: '/admin',
        title: config.APP_NAME + ' Admin',
        modulesGlob: new URL('../modules/**/*.admin.ts', import.meta.url).pathname,
      },
    },
    { plugin: createJobsPlugin, options: { ... } },
  ],
});
```

## Adding an override

```ts
// modules/posts/posts.admin.ts
import { defineAdminResource } from '@kit/admin';

export default defineAdminResource('posts', async ({ cradle }) => ({
  label: 'Posts',
  icon: 'file-text',
  hidden: ['deletedAt'],
  readOnly: ['id', 'createdAt', 'updatedAt'],
  widgets: {
    content: 'textarea',
    status: 'radio-group',
  },
  list: {
    columns: ['title', 'status', 'authorId', 'createdAt'],
    search: ['title', 'content'],
  },
  permissions: { subject: 'Post' },
}));
```

Everything you don't set falls back to the inferred default.

## Widget inference table

See `discovery/infer-widget.ts` -- maps `(PgType, maxLength, enumValues,
references)` to `WidgetKind`. Override per-field via `widgets: {...}`.
