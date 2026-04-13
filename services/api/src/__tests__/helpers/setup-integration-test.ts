import type { DB } from '#db/schema.ts';
import { setupIntegrationTest as setup } from '@kit/test/helpers';

import { createTestApp } from './test-app.ts';

export const setupIntegrationTest = () =>
  setup<DB>({
    createApp: createTestApp,
    // Migrations run inside createTestApp (before server boot) because
    // @kit/admin queries information_schema during plugin registration.
    beforeEachCleanup: ({ server }) => {
      if (
        'redis' in server &&
        server.redis &&
        typeof server.redis === 'object' &&
        'flushall' in server.redis
      ) {
        (server.redis as { flushall: () => void }).flushall();
      }
    },
  });
