import { defineConfig } from 'vitest/config';

export default defineConfig({
  envDir: '../../',
  test: {
    globals: true,
    passWithNoTests: true,
    include: ['src/**/*.spec.ts'],
    setupFiles: ['@kit/test/setup/redis-mock', '@kit/test/setup/bull-mock'],
    sequence: {
      setupFiles: 'list',
      hooks: 'stack',
      shuffle: { files: true },
    },
    forks: {
      execArgv: ['--experimental-strip-types'],
    },
    server: {
      deps: {
        inline: ['@fastify/autoload'],
      },
    },
    env: {
      NODE_NO_WARNINGS: '1',
      ENVIRONMENT: 'test',
    },
    hookTimeout: 60_000,
  },
});
