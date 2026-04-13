import { baseConfig } from '@kit/eslint-config';

export default [
  ...baseConfig,
  {
    files: ['migrations/**'],
    rules: { 'unicorn/filename-case': 'off' },
  },
];
