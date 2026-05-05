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
    /**
     * Public-facing URL of the API. Used to build absolute links in
     * transactional emails (password-reset / email-verify accept URLs).
     * Falls back to a localhost dev URL.
     */
    APP_URL: z.string().url().default('http://localhost:3000'),
    /**
     * Audit log retention. Rows older than this many days are pruned by
     * the `audit.prune` BullMQ repeatable (runs at 03:00 UTC daily).
     */
    AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  },
  { envPath: findWorkspaceRoot(import.meta.dirname) },
);

export type AppConfig = typeof config;
