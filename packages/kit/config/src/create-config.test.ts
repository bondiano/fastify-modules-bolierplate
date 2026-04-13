import { describe, expect, it } from 'vitest';

import { Environment, createConfig, z } from './create-config.js';

describe('createConfig', () => {
  const baseEnv = {
    ENVIRONMENT: 'development',
    HOST: '0.0.0.0',
    PORT: '3000',
    APP_NAME: 'test-app',
    APP_VERSION: '1.0.0',
    LOG_LEVEL: 'info',
  };

  it('parses base schema with defaults', () => {
    const config = createConfig({}, { env: {} });

    expect(config.ENVIRONMENT).toBe(Environment.Development);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.PORT).toBe(3000);
    expect(config.isDev).toBe(true);
    expect(config.isProd).toBe(false);
  });

  it('merges extra schema fields', () => {
    const config = createConfig(
      { DATABASE_URL: z.string(), REDIS_URL: z.string() },
      {
        env: {
          ...baseEnv,
          DATABASE_URL: 'postgres://localhost/db',
          REDIS_URL: 'redis://localhost',
        },
      },
    );

    expect(config.DATABASE_URL).toBe('postgres://localhost/db');
    expect(config.REDIS_URL).toBe('redis://localhost');
    expect(config.APP_NAME).toBe('test-app');
  });

  it('sets environment helper flags correctly', () => {
    const productionConfig = createConfig(
      {},
      { env: { ENVIRONMENT: 'production' } },
    );
    expect(productionConfig.isProd).toBe(true);
    expect(productionConfig.isDev).toBe(false);

    const testConfig = createConfig({}, { env: { ENVIRONMENT: 'test' } });
    expect(testConfig.isTest).toBe(true);

    const stagingConfig = createConfig({}, { env: { ENVIRONMENT: 'staging' } });
    expect(stagingConfig.isStaging).toBe(true);
  });

  it('throws on invalid env values', () => {
    expect(() =>
      createConfig({}, { env: { ENVIRONMENT: 'invalid' } }),
    ).toThrow();
  });

  it('supports zod transforms in extra schema', () => {
    const config = createConfig(
      {
        TAGS: z.string().transform((v) => v.split(',').map((t) => t.trim())),
      },
      { env: { ...baseEnv, TAGS: 'foo, bar, baz' } },
    );

    expect(config.TAGS).toEqual(['foo', 'bar', 'baz']);
  });
});
