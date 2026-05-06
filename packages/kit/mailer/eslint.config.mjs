import { baseConfig } from '@kit/eslint-config';

export default [
  ...baseConfig,
  {
    files: ['migrations/**'],
    rules: { 'unicorn/filename-case': 'off' },
  },
  {
    // The build-step CLI prints compile progress to stdout by design;
    // it also uses Node's standard `dir` / `outDir` shorthand that the
    // unicorn `prevent-abbreviations` rule flags too aggressively.
    files: ['tools/**'],
    rules: {
      'unicorn/filename-case': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'no-console': 'off',
    },
  },
  {
    // Vendor SDK adapter wrappers necessarily mirror deeply nested
    // structural types from the upstream SDKs (`SesSendInput.Content.Simple.Body...`,
    // Postmark's `Headers: { Name; Value }[]`, AWS SES SNS envelopes,
    // etc). Extracting each into a named interface adds noise without
    // improving readability. UTF-8 strings are also passed verbatim to
    // SES SDK constants where the casing is fixed.
    files: ['src/transports/**', 'src/webhooks/**'],
    rules: {
      'kit-custom/no-complex-inline-type': 'off',
      'unicorn/text-encoding-identifier-case': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-useless-undefined': 'off',
    },
  },
  {
    // `dev-memory` is the industry term for in-process dev backends.
    files: ['src/transports/dev-memory.ts'],
    rules: { 'unicorn/prevent-abbreviations': 'off' },
  },
  {
    // `Dir` is canonical Node fs.* terminology. The render module
    // also accepts a small literal default for `options` -- the
    // function is a single-call helper.
    files: ['src/templates/render.ts'],
    rules: {
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-object-as-default-parameter': 'off',
    },
  },
];
