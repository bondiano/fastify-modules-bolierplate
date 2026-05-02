import type { DB } from '#db/schema.ts';
import { setupIntegrationTest as setup } from '@kit/test/helpers';

import { createTestApp } from './test-app.ts';

export const setupIntegrationTest = () =>
  setup<DB>({
    createApp: createTestApp,
  });
