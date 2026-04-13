import path from 'node:path';
import { loadEnvFile } from 'node:process';

const tryLoadEnvFile = (filePath: string): boolean => {
  try {
    loadEnvFile(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Load .env files in cascading order based on the current ENVIRONMENT.
 *
 * Loading order (last loaded wins for conflicts):
 *   .env.{environment}.local -> .env.{environment} -> .env.local -> .env
 *
 * @param basePath - Directory containing .env files (project root)
 * @returns List of successfully loaded file paths
 */
export const loadEnvironmentFiles = (basePath: string): readonly string[] => {
  const environment = process.env.ENVIRONMENT || 'development';

  const filesToLoad = [
    `.env.${environment}.local`,
    `.env.${environment}`,
    '.env.local',
    '.env',
  ].map((fileName) => path.join(basePath, fileName));

  const loadedFiles: string[] = [];

  for (const file of filesToLoad) {
    if (tryLoadEnvFile(file)) {
      loadedFiles.push(file);
    }
  }

  return loadedFiles;
};
