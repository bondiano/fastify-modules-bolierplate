import { authConfigSchema } from '@kit/auth/config';
import { createConfig, findWorkspaceRoot, z } from '@kit/config';
import { dbConfigSchema } from '@kit/db/config';
import { jobsConfigSchema } from '@kit/jobs/config';

export const config = createConfig(
  {
    ...dbConfigSchema,
    ...authConfigSchema,
    ...jobsConfigSchema,
    CORS_ORIGINS: z.string().default('*'),
  },
  { envPath: findWorkspaceRoot(import.meta.dirname) },
);

export type AppConfig = typeof config;
