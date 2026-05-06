import { baseConfig } from '@kit/eslint-config';

export default [
  ...baseConfig,
  {
    files: ['migrations/**'],
    rules: { 'unicorn/filename-case': 'off' },
  },
  {
    // Job + webhook handlers in the mailer module declare local
    // `*Cradle` interfaces that mirror the deeply-nested cradle slice
    // they consume. These are duck-typed contracts (the kit doesn't
    // export the runtime cradle type into the consumer) so the
    // structural shape lives inline. Same justification as the
    // `@kit/mailer` transports + webhooks override.
    files: ['src/modules/mailer/**'],
    rules: {
      'kit-custom/no-complex-inline-type': 'off',
      'unicorn/no-empty-file': 'off',
    },
  },
  {
    // Billing module: same justification as mailer -- duck-typed
    // cradle contracts mirror nested kit shapes. Empty `*.module.ts`
    // marker files exist purely so the modules glob picks the dir up.
    files: ['src/modules/billing/**'],
    rules: {
      'kit-custom/no-complex-inline-type': 'off',
      'unicorn/no-empty-file': 'off',
    },
  },
];
