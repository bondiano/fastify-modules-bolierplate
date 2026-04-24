import type { FileSystem } from '@effect/platform';
import { Path } from '@effect/platform';
import { Effect } from 'effect';

import type { WorkspaceNotFoundError } from './errors.ts';
import { findWorkspaceRoot } from './workspace-root.ts';

export interface GeneratorPaths {
  readonly workspaceRoot: string;
  readonly apiService: string;
  readonly modulesDir: string;
  readonly migrationsDir: string;
}

export interface ResolvePathsOptions {
  readonly fromDir?: string;
  readonly workspaceRoot?: string;
}

export const resolvePaths = (
  options: ResolvePathsOptions = {},
): Effect.Effect<
  GeneratorPaths,
  WorkspaceNotFoundError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const workspaceRoot =
      options.workspaceRoot ??
      (yield* findWorkspaceRoot(options.fromDir ?? process.cwd()));
    const apiService = path.join(workspaceRoot, 'services', 'api');
    return {
      workspaceRoot,
      apiService,
      modulesDir: path.join(apiService, 'src', 'modules'),
      migrationsDir: path.join(apiService, 'migrations'),
    };
  });
