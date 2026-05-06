import { baseConfig } from '@kit/eslint-config';

export default [
  ...baseConfig,
  {
    files: ['migrations/**'],
    rules: { 'unicorn/filename-case': 'off' },
  },
  {
    files: ['tools/**'],
    rules: {
      'unicorn/filename-case': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'no-console': 'off',
    },
  },
  {
    // Vendor SDK adapter wrappers necessarily mirror deeply nested
    // structural types from the upstream Stripe SDK (Stripe.Event,
    // Stripe.Subscription.Status, Stripe.Checkout.Session.Mode, ...).
    // Extracting each into a named interface adds noise without
    // improving readability.
    files: ['src/providers/**'],
    rules: {
      'kit-custom/no-complex-inline-type': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-useless-undefined': 'off',
    },
  },
  {
    // Repository factories pass typed callbacks into Kysely's
    // `onConflict(...)` builder; the callback signature is naturally
    // 3+ levels deep (`oc => column => doUpdateSet(...)`). Extracting
    // each into a named interface adds noise without making the
    // call site clearer.
    files: ['src/*-repository.ts'],
    rules: {
      'kit-custom/no-complex-inline-type': 'off',
    },
  },
];
