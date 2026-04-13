import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_MARKERS = [
  'pnpm-workspace.yaml',
  'pnpm-workspace.yml',
] as const;

const isWorkspaceRoot = (directory: string): boolean =>
  WORKSPACE_MARKERS.some((marker) =>
    fs.existsSync(path.join(directory, marker)),
  );

/**
 * Walk up from `startDirectory` until a directory containing `pnpm-workspace.yaml` is found.
 *
 * @param startDirectory - Directory to start searching from (typically `import.meta.dirname`)
 * @returns Absolute path to the workspace root
 * @throws {Error} If no workspace root is found before reaching the filesystem root
 *
 * @example
 * ```ts
 * const config = createConfig(
 *   { DATABASE_URL: z.string() },
 *   { envPath: findWorkspaceRoot(import.meta.dirname) },
 * );
 * ```
 */
export const findWorkspaceRoot = (startDirectory: string): string => {
  let current = path.resolve(startDirectory);

  while (true) {
    if (isWorkspaceRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw new Error(
        `Could not find workspace root (pnpm-workspace.yaml) starting from: ${startDirectory}`,
      );
    }

    current = parent;
  }
};
