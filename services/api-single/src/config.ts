import { createConfig, findWorkspaceRoot, z } from '@kit/config';
import { dbConfigSchema } from '@kit/db/config';

export const config = createConfig(
  {
    ...dbConfigSchema,
    CORS_ORIGINS: z.string().default('*'),
  },
  { envPath: findWorkspaceRoot(import.meta.dirname) },
);

export type AppConfig = typeof config;
