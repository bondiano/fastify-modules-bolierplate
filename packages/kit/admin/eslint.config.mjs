import { baseConfig } from '@kit/eslint-config';

export default [
  {
    ignores: ['assets/**', 'dist/**'],
  },
  ...baseConfig,
];
