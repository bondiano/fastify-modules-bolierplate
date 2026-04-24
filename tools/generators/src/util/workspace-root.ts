import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';

import { WorkspaceNotFoundError } from './errors.ts';

/**
 * Walk up from `startDirectory` until a `pnpm-workspace.yaml` is found,
 * returning that directory. Fails with `WorkspaceNotFoundError` if the
 * filesystem root is reached first.
 */
export const findWorkspaceRoot = (
  startDirectory: string,
): Effect.Effect<
  string,
  WorkspaceNotFoundError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    let directory = path.resolve(startDirectory);
    while (true) {
      const marker = path.join(directory, 'pnpm-workspace.yaml');
      const exists = yield* fs
        .exists(marker)
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) return directory;

      const parent = path.dirname(directory);
      if (parent === directory) {
        return yield* Effect.fail(
          new WorkspaceNotFoundError({ startDirectory }),
        );
      }
      directory = parent;
    }
  });
