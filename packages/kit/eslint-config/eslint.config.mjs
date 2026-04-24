import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import prettierPlugin from 'eslint-plugin-prettier/recommended';
import importPlugin, { createNodeResolver } from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import noComplexInlineType from './no-complex-inline-type.mjs';

export const baseConfig = [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  unicorn.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    plugins: {
      'import-x': importPlugin,
      'kit-custom': {
        rules: { 'no-complex-inline-type': noComplexInlineType },
      },
    },
    settings: {
      'import-x/internal-regex': '^@kit(/|$)',
      'import-x/resolver-next': [
        createTypeScriptImportResolver(),
        createNodeResolver(),
      ],
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Unicorn overrides
      'unicorn/prevent-abbreviations': [
        'error',
        {
          replacements: {
            db: false,
            env: false,
            fn: false,
            req: false,
            res: false,
            err: false,
            args: false,
            params: false,
            props: false,
            config: false,
            ctx: false,
            ref: false,
            deps: false,
            opts: false,
            pkg: false,
            trx: false,
            cb: false,
          },
        },
      ],
      'unicorn/no-null': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-top-level-await': 'off',

      // Custom rules
      'kit-custom/no-complex-inline-type': [
        'error',
        { maxDepth: 2, maxProperties: 4 },
      ],
    },
  },
  prettierPlugin,
];

export default baseConfig;
