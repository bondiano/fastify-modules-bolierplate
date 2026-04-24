import { Args, Command, Options } from '@effect/cli';
import type { FileSystem } from '@effect/platform';
import { Path } from '@effect/platform';
import { Console, Effect } from 'effect';

import {
  emptyMigrationTemplate,
  migrationTimestamp,
  sanitizeMigrationName,
} from '../templates/migration.ts';
import { resolvePaths } from '../util/paths.ts';
import { runGenerator } from '../util/runtime.ts';
import { createWriter } from '../util/writer.ts';

export interface GenerateMigrationOptions {
  readonly name: string;
  readonly dryRun?: boolean;
  readonly log?: (message: string) => void;
}

export const generateMigrationEffect = (
  options: GenerateMigrationOptions,
): Effect.Effect<void, Error, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const userLog = options.log;
    const log = userLog
      ? (message: string) => Effect.sync(() => userLog(message))
      : (message: string) => Console.log(message);

    const safeName = sanitizeMigrationName(options.name);
    const timestamp = migrationTimestamp();
    const paths = yield* resolvePaths();

    const filePath = path.join(
      paths.migrationsDir,
      `${timestamp}_${safeName}.ts`,
    );

    const writer = yield* createWriter({
      dryRun: options.dryRun ?? false,
      log,
    });
    yield* writer.writeFile(filePath, emptyMigrationTemplate());
  }).pipe(
    Effect.mapError((error) =>
      error instanceof Error ? error : new Error(String(error)),
    ),
  );

export const generateMigration = (
  options: GenerateMigrationOptions,
): Promise<void> => runGenerator(generateMigrationEffect(options));

const nameArgument = Args.text({ name: 'name' }).pipe(
  Args.withDescription('Migration name (e.g. add-widget-price)'),
);
const dryRunOption = Options.boolean('dry-run').pipe(
  Options.withDescription("Print what would be written, don't touch disk"),
);

export const migrationCommand = Command.make(
  'migration',
  { name: nameArgument, dryRun: dryRunOption },
  ({ name, dryRun }) => generateMigrationEffect({ name, dryRun }),
).pipe(
  Command.withDescription('Scaffold an empty timestamped Kysely migration'),
);
