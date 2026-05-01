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

## Tenant-scope inference (`@kit/tenancy` integration)

The admin auto-detects tenant scoping from `information_schema`:

- A table with a `tenant_id` (or camelCase `tenantId`) column infers
  `tenantScoped: true` + `scope: 'tenant'`. The underlying repository must
  be wrapped in `createTenantScopedRepository` from `@kit/tenancy` (the
  admin does not inject the SQL filter itself; it relies on the repo).
- Tables without a tenant column infer `tenantScoped: false` +
  `scope: 'system'`.

Overrides can flip both flags explicitly when inference picks the wrong
answer (e.g. a system-owned analytics table that carries a denormalised
`tenant_id` column for queries):

```ts
defineAdminResource('user_activity_summary', async () => ({
  // Has tenant_id but reads cross-tenant; render at the system level.
  tenantScoped: false,
  scope: 'system',
}));
```

### Runtime guard

Every CRUD route calls `assertTenantForResource(spec, request)` before
hitting the repo. If `spec.tenantScoped === true` and `request.tenant`
is unset, the handler throws `BadRequestException` with code
`TENANT_REQUIRED_FOR_ADMIN`. The cookie-backed tenant switcher
(`P2.tenancy.11`) is what catches this and redirects the user to the
picker; until then the consumer service is responsible for ensuring
a tenant frame exists before the user navigates to a tenant-scoped
resource.

### Public-route bypass

`/admin/login`, `/admin/logout`, and `/admin/_assets/*` set
`config.tenant: 'bypass'` so the consumer's `@kit/tenancy` plugin skips
resolution on them. Without the marker, an unauthenticated visitor
hitting the login page would get a 400 from the tenancy resolver. The
admin re-declares the `FastifyContextConfig.tenant` augmentation locally
so it does not need a hard import dependency on `@kit/tenancy`.

## Side-nav grouping

Resources are flat in the side nav by default. Pass `group: 'Some Label'`
to `defineAdminResource(...)` to bucket related resources under a common
heading. Items without a `group` are rendered above any groups; groups
themselves are alphabetised by label so the rendering is stable across
auto-discovery order. Pass `group: null` to un-group an inherited spec.

```ts
// services/<svc>/src/modules/tenancy/tenants.admin.ts
defineAdminResource('tenants', async () => ({
  group: 'Tenancy',
  // ...
}));
```

## Detail-page actions

`AdminResourceSpec.detailActions` adds custom buttons next to "Save" /
"Cancel" on the edit form. Each entry is render-only -- the kit ships no
handler. The consumer registers a Fastify route that lives somewhere
matching the action's `href(id)` and does its own auth (typically
`verifyAdmin`). The boilerplate uses this to wire the
`Resend invitation` action on `/admin/invitations/:id`:

```ts
defineAdminResource('invitations', async () => ({
  detailActions: [
    {
      label: 'Resend invitation',
      method: 'POST',
      href: (id) => `/admin/invitations/${id}/regenerate`,
      confirm: 'Generate a new accept link? The old one will stop working.',
    },
  ],
}));
```

`GET` actions render as anchor tags (htmx-enhanced); `POST` actions
render inside their own inline form so they don't accidentally submit
the surrounding edit form. The `confirm` string gates the click via a
JS `confirm()` prompt -- it's display-only, the server-side handler
must still validate. `kind: 'danger'` styles the button as destructive.

## Widget inference table

See `discovery/infer-widget.ts` -- maps `(PgType, maxLength, enumValues,
references)` to `WidgetKind`. Override per-field via `widgets: {...}`.
