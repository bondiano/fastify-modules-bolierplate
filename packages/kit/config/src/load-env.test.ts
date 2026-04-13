import path from 'node:path';
import { loadEnvFile } from 'node:process';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import { loadEnvironmentFiles } from './load-env.js';

vi.mock('node:process', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    loadEnvFile: vi.fn(),
  };
});

const loadEnvFileMock = loadEnvFile as Mock;

describe('loadEnvironmentFiles', () => {
  const basePath = '/app';

  beforeEach(() => {
    loadEnvFileMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('loads files in cascading order for development', () => {
    vi.stubEnv('ENVIRONMENT', 'development');
    loadEnvFileMock.mockImplementation(() => {});

    const loaded = loadEnvironmentFiles(basePath);

    expect(loadEnvFileMock).toHaveBeenCalledTimes(4);
    expect(loadEnvFileMock).toHaveBeenNthCalledWith(
      1,
      path.join(basePath, '.env.development.local'),
    );
    expect(loadEnvFileMock).toHaveBeenNthCalledWith(
      2,
      path.join(basePath, '.env.development'),
    );
    expect(loadEnvFileMock).toHaveBeenNthCalledWith(
      3,
      path.join(basePath, '.env.local'),
    );
    expect(loadEnvFileMock).toHaveBeenNthCalledWith(
      4,
      path.join(basePath, '.env'),
    );
    expect(loaded).toHaveLength(4);
  });

  it('uses ENVIRONMENT env var for file names', () => {
    vi.stubEnv('ENVIRONMENT', 'production');
    loadEnvFileMock.mockImplementation(() => {});

    loadEnvironmentFiles(basePath);

    expect(loadEnvFileMock).toHaveBeenNthCalledWith(
      1,
      path.join(basePath, '.env.production.local'),
    );
    expect(loadEnvFileMock).toHaveBeenNthCalledWith(
      2,
      path.join(basePath, '.env.production'),
    );
  });

  it('skips files that do not exist', () => {
    loadEnvFileMock.mockImplementation((filePath: string) => {
      if (filePath.includes('.local')) {
        throw new Error('ENOENT');
      }
    });

    const loaded = loadEnvironmentFiles(basePath);

    expect(loaded).toEqual([
      path.join(basePath, '.env.development'),
      path.join(basePath, '.env'),
    ]);
  });

  it('defaults to development when ENVIRONMENT is not set', () => {
    vi.stubEnv('ENVIRONMENT', '');
    delete process.env.ENVIRONMENT;
    loadEnvFileMock.mockImplementation(() => {});

    loadEnvironmentFiles(basePath);

    expect(loadEnvFileMock).toHaveBeenNthCalledWith(
      1,
      path.join(basePath, '.env.development.local'),
    );
  });
});
