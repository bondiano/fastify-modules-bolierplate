# @kit/eslint-config

Shared ESLint 10 flat config. Every kit package and service imports
`baseConfig` from here and appends per-package overrides.

## Files

```
eslint.config.mjs           Exports baseConfig (named + default)
no-complex-inline-type.mjs  Custom rule -- caps inline type literal depth/width
package.json                Declares ESLint plugins as deps; eslint itself is a peer
```

Published as `@kit/eslint-config`. Single entrypoint -- `import { baseConfig } from '@kit/eslint-config'`.

## Stack

- `@eslint/js` -- JS recommended
- `typescript-eslint` -- TS parser + recommended rules
- `eslint-plugin-unicorn` -- opinionated code quality rules
- `eslint-plugin-import-x` -- import ordering + resolution (TS + node)
- `eslint-plugin-prettier/recommended` -- runs Prettier as a lint rule
- `kit-custom/no-complex-inline-type` -- in-repo rule (see below)

Globals come from `globals.node`; `ecmaVersion: 2023`, `sourceType: 'module'`.
Ignores: `dist/`, `node_modules/`, `.turbo/`, `coverage/`.

## Custom rules

### `kit-custom/no-complex-inline-type`

Forbids inline TypeScript object-type literals that are too deeply nested or
have too many properties. Forces extraction into a named `type` / `interface`.

**Default options** (set in `baseConfig`): `{ maxDepth: 2, maxProperties: 4 }`.

- **Exempt**: the top-level body of a `type` / `interface` declaration. We
  only care about inline literals used as function parameters, return types,
  generics, etc.
- **Triggered** when either the literal is nested deeper than `maxDepth` or
  has more than `maxProperties` keys at its own level.

Rationale: these literals turn error messages into unreadable walls. A named
type gives LSP hover output a single click-through target.

Rule source: [`no-complex-inline-type.mjs`](./no-complex-inline-type.mjs).

## Key enforced rules

- `@typescript-eslint/consistent-type-imports: 'error'` -- pairs with
  `verbatimModuleSyntax` in `@kit/ts-config`; every type-only import must use
  `import type`.
- `@typescript-eslint/no-unused-vars` with `^_` ignore pattern -- prefix
  intentionally unused args/vars with `_`.
- `import-x/order` -- groups builtin / external / internal / parent / sibling
  / index with a blank line between groups, alphabetized case-insensitively.
- `import-x/internal-regex: '^@kit(/|$)'` -- treats `@kit/*` as **internal**
  imports, grouped after `external`.
- `no-console: ['warn', { allow: ['warn', 'error'] }]` -- `console.log` is
  a warning; use the Pino logger. `console.warn/error` remain legal for
  CLI scripts and pre-boot fallbacks.
- `unicorn/prevent-abbreviations` -- long list of allowed abbreviations
  (`db`, `env`, `fn`, `req`, `res`, `err`, `args`, `params`, `props`,
  `config`, `ctx`, `ref`, `deps`, `opts`, `pkg`, `trx`, `cb`). Extend the
  allowlist if a common domain term keeps getting flagged; don't disable the
  rule wholesale.
- `unicorn/no-null`, `unicorn/no-process-exit`, `unicorn/prefer-module`,
  `unicorn/prefer-top-level-await` -- **off**. These conflict with Kysely
  (`null`-able columns), CLI scripts, CJS interop, and the `--experimental-strip-types`
  runtime.

Prettier runs last via `eslint-plugin-prettier/recommended`.

## Consumer usage

### Pure consumer (most kit packages)

```js
// packages/kit/<name>/eslint.config.mjs
export { baseConfig as default } from '@kit/eslint-config';
```

### Consumer with ignores

```js
// packages/kit/admin/eslint.config.mjs
import { baseConfig } from '@kit/eslint-config';

export default [{ ignores: ['assets/**', 'dist/**'] }, ...baseConfig];
```

### Consumer with per-file overrides

```js
// services/api/eslint.config.mjs
import { baseConfig } from '@kit/eslint-config';

export default [
  ...baseConfig,
  {
    files: ['migrations/**'],
    rules: { 'unicorn/filename-case': 'off' },
  },
];
```

### `package.json` wiring

```jsonc
{
  "devDependencies": {
    "@kit/eslint-config": "workspace:*",
    "eslint": "^10.0.0"
  },
  "scripts": {
    "lint": "eslint ."
  }
}
```

ESLint itself is a **peer dependency** of `@kit/eslint-config` -- consumers
install it. Plugins (unicorn, import-x, typescript-eslint) ship as
`dependencies` of this package so consumers don't need to list them.

## How to add a rule

1. **Global rule change** (affects every package): edit
   `eslint.config.mjs` `rules` block. Run `pnpm lint` from the repo root to
   see what breaks. If more than a handful of files fail, either prepare a
   codemod PR before turning it on, or stage it as `'warn'` first.

2. **Per-package override**: append a config object to that package's
   `eslint.config.mjs`:

   ```js
   export default [
     ...baseConfig,
     { files: ['src/cli/**'], rules: { 'no-console': 'off' } },
   ];
   ```

3. **Adding a custom rule**:

   - Drop the rule module next to `no-complex-inline-type.mjs`
   - Register it inside `baseConfig` under `plugins['kit-custom'].rules`
   - Document defaults + rationale in this file

4. **Never** use `/* eslint-disable */` as a long-term fix. If a rule
   genuinely doesn't apply to an entire directory (e.g. migrations, scripts),
   disable it at the config level with a `files:` glob.

## Per-package override examples

| File / directory            | Override                                           | Why                                                      |
| --------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `migrations/**`             | `unicorn/filename-case: 'off'`                     | Migration filenames start with timestamps (`20260101_`). |
| `**/*.spec.ts` (if needed)  | `unicorn/no-null: 'off'`                           | Test assertions against DB `null` values.                |
| `src/cli/**`                | `no-console: 'off'`                                | CLIs print to stdout before logger boot.                 |
| Generated code directories  | ignore entry                                       | Don't lint generated files; fix the generator.           |

## Gotchas

- **Flat config only.** Don't add `.eslintrc.*` files anywhere in the repo --
  they won't be picked up and will confuse reviewers.
- **`import-x` resolver** is set to `typescript: true, node: true`. If you
  add a new subpath export to a package (e.g. `@kit/foo/bar`), make sure the
  consumer's `package.json#exports` / `imports` + `tsconfig#paths` are in
  sync or the import order rule will mis-group it.
- **Prettier is part of lint.** Prettier violations surface as ESLint errors
  via `eslint-plugin-prettier`. `pnpm lint --fix` runs Prettier as well.
  A separate `pnpm format` is intentionally not provided.
- **ESLint version**: peer is `^9.22.0 || ^10.0.0`. The repo ships on 10;
  don't introduce rules that only exist in 9.
- **Don't `extends`-style merge**. Flat config is array-based -- spread
  `...baseConfig` and append, never wrap it in an object with `extends`.
