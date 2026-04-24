# @kit/ts-config

Shared TypeScript compiler configurations. Three presets, each targeting a
different layer of the monorepo. Services and kit packages `extend` one of
them and add only `rootDir` / `outDir` / path overrides.

## Directory

```
tsconfig.base.json   Language settings only (strict, NodeNext, verbatim modules)
tsconfig.node.json   extends ./base, adds Node.js lib + @types/node
tsconfig.lib.json    extends ./node, adds declaration/composite/outDir for buildable packages
```

Exposed via `package.json#exports` as:

- `@kit/ts-config/base`
- `@kit/ts-config/node`
- `@kit/ts-config/lib`

## When to extend which preset

| Consumer                                      | Extend                   | Why                                                                                                              |
| --------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `services/<name>` (runs Node, doesn't emit)   | `@kit/ts-config/node`    | App uses `node --experimental-strip-types`; TypeScript is used only for `--noEmit` type-checking.                |
| `packages/kit/<name>` (publishable kit pkg)   | `@kit/ts-config/lib`     | Ships `dist/*.js` + `.d.ts` to consumers. Needs `declaration`, `composite`, `sourceMap`.                         |
| `packages/kit/ts-config` / config-only pkg    | `@kit/ts-config/base`    | Pure language settings, no runtime environment. Rare -- use `./node` unless you really don't want `lib: ES2023`. |

Rule of thumb: if your `package.json` has a `build` script emitting `dist/`,
extend `./lib`. If it runs source at dev time and only type-checks, extend
`./node`.

## What the presets enable

### `./base`

Language rules shared by everything:

- `target: ES2023`, `module/moduleResolution: NodeNext`
- `strict: true`
- `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`,
  `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`
- `verbatimModuleSyntax: true` -- forces explicit `import type` when
  importing types
- `isolatedModules: true` -- required for `swc` / `--experimental-strip-types`
- `esModuleInterop`, `forceConsistentCasingInFileNames`,
  `resolveJsonModule`, `skipLibCheck`

### `./node` (extends base)

- `lib: ["ES2023"]` (no DOM)
- `types: ["node"]` -- pulls in `@types/node` globals

### `./lib` (extends node)

Adds emit settings for buildable packages:

- `declaration: true`, `declarationMap: true`, `sourceMap: true`
- `composite: true` -- participates in project references
- `outDir: dist`

## Typical consumer `tsconfig.json`

### Service (no emit)

```jsonc
{
  "extends": "@kit/ts-config/node",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "tsBuildInfoFile": "dist/.tsbuildinfo",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "paths": { "#*": ["./src/*"] },
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"],
}
```

### Kit package (emits to dist)

```jsonc
{
  "extends": "@kit/ts-config/lib",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo",
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "**/*.test.ts"],
  "references": [{ "path": "../config" }],
}
```

### Test-only tsconfig

When a package has runtime tests (`*.test.ts`) that live in `src/` but must
not ship in `dist/`, exclude the tests from the main tsconfig (as above) and
let Vitest type-check them at runtime via `--experimental-strip-types`.
Add a separate `tsconfig.test.json` only if you need different options for
tests -- avoid doing this by default.

## Path alias convention

We use **Node.js subpath imports** (`"#*"` keys in `package.json#imports`),
**not** TypeScript path aliases in the general case. This keeps the alias
working at runtime with `node --experimental-strip-types` without a bundler.

### Service-level subpaths

```jsonc
// services/api/package.json
{
  "imports": {
    "#*": {
      "development": "./src/*",
      "types": "./src/*",
      "production": "./src/*",
      "default": "./src/*"
    }
  }
}
```

```jsonc
// services/api/tsconfig.json
{
  "compilerOptions": {
    "paths": { "#*": ["./src/*"] }
  }
}
```

TS `paths` is a mirror of `imports` so the compiler resolves `#db/schema.ts`
to `./src/db/schema.ts`. Both must stay in sync -- if you add a new prefix
(e.g. `#modules/*`), add it in both places.

### Kit-package cross-package imports

Packages import each other by **public package name** (`@kit/core`,
`@kit/db/runtime`, `@kit/auth/config`), never via relative paths into
another package. Sub-entrypoints are declared via the consumer's
`package.json#exports`, not via `paths`.

**Rule**: `paths` is only for within-package aliasing. Cross-package
references go through `exports`.

## Project references

Kit packages that depend on other kit packages add `references` entries so
`tsc -b` can build them in dependency order:

```jsonc
"references": [{ "path": "../config" }]
```

Matches `composite: true` from `./lib`. Services typically don't need
references -- they run TS at dev time and only type-check.

## Conventions recap

- Extend `./node` for services, `./lib` for kit packages, `./base` almost never.
- Keep each consumer `tsconfig.json` small -- only `rootDir`, `outDir`,
  `include`, `exclude`, `paths`, `references`.
- Don't re-enable compiler flags that `./base` already sets; if a flag hurts
  a single package, the right fix is usually a code change.
- Never set `strict: false` or disable any of the extra strict flags
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Path aliases: subpath imports (`#*`) inside a package; package names across
  packages. No relative paths that climb out of a package's own `src/`.

## Adding a new preset

Resist. We had three before for a reason -- each one corresponds to a
concrete role in the monorepo. If you think you need a fourth, first check
whether the new consumer can live with one of the existing presets plus a
tiny override in its own `tsconfig.json`.
