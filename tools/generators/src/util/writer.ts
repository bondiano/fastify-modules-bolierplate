import { FileSystem, Path } from '@effect/platform';
import { Console, Effect, Ref } from 'effect';

export type WriteStatus = 'created' | 'skipped' | 'overwritten' | 'dry-run';

export interface WrittenFile {
  readonly path: string;
  readonly status: WriteStatus;
}

export interface WriterOptions {
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly log?: (message: string) => Effect.Effect<void>;
}

export interface Writer {
  readonly writeFile: (
    filePath: string,
    content: string,
  ) => Effect.Effect<WrittenFile, Error, FileSystem.FileSystem | Path.Path>;
  readonly written: Effect.Effect<readonly WrittenFile[]>;
}

const defaultLog = (message: string): Effect.Effect<void> =>
  Console.log(message);

export const createWriter = (
  options: WriterOptions = {},
): Effect.Effect<Writer> =>
  Effect.gen(function* () {
    const dryRun = options.dryRun ?? false;
    const force = options.force ?? false;
    const log = options.log ?? defaultLog;
    const writtenRef = yield* Ref.make<readonly WrittenFile[]>([]);

    const writeFile = (
      filePath: string,
      content: string,
    ): Effect.Effect<WrittenFile, Error, FileSystem.FileSystem | Path.Path> =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const exists = yield* fs
          .exists(filePath)
          .pipe(Effect.orElseSucceed(() => false));

        if (exists && !force) {
          const entry = { path: filePath, status: 'skipped' } as const;
          yield* Ref.update(writtenRef, (xs) => [...xs, entry]);
          yield* log(
            `  skip    ${filePath} (already exists, pass --force to overwrite)`,
          );
          return entry;
        }

        if (dryRun) {
          const entry = { path: filePath, status: 'dry-run' } as const;
          yield* Ref.update(writtenRef, (xs) => [...xs, entry]);
          yield* log(`  dry     ${filePath}`);
          return entry;
        }

        yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
        yield* fs.writeFileString(filePath, content);
        const entry = {
          path: filePath,
          status: exists ? 'overwritten' : 'created',
        } as const;
        yield* Ref.update(writtenRef, (xs) => [...xs, entry]);
        yield* log(
          `  ${entry.status === 'created' ? 'create ' : 'update '} ${filePath}`,
        );
        return entry;
      }).pipe(
        Effect.mapError((error) =>
          error instanceof Error ? error : new Error(String(error)),
        ),
      );

    return {
      writeFile,
      written: Ref.get(writtenRef),
    };
  });

export const fileExists = (
  filePath: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
  });

export const directoryExists = (
  directoryPath: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stat = yield* fs.stat(directoryPath).pipe(Effect.option);
    return stat._tag === 'Some' && stat.value.type === 'Directory';
  });
