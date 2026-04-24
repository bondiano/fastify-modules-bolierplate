import { Args, Command, Options } from '@effect/cli';
import { FileSystem, Path } from '@effect/platform';
import { Console, Effect, Option } from 'effect';

import { adminTemplate } from '../templates/admin.ts';
import { introspectTable } from '../util/db-introspect.ts';
import { GeneratorError } from '../util/errors.ts';
import { buildModuleNames } from '../util/names.ts';
import { resolvePaths } from '../util/paths.ts';
import { runGenerator } from '../util/runtime.ts';
import { createWriter, directoryExists } from '../util/writer.ts';

export interface GenerateAdminOptions {
  readonly moduleName: string;
  readonly databaseUrl?: string;
  readonly subject?: string;
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly log?: (message: string) => void;
}

export const generateAdminEffect = (
  options: GenerateAdminOptions,
): Effect.Effect<void, Error, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const userLog = options.log;
    const log = userLog
      ? (message: string) => Effect.sync(() => userLog(message))
      : (message: string) => Console.log(message);

    const names = buildModuleNames(options.moduleName);
    const paths = yield* resolvePaths();
    const moduleDirectory = path.join(paths.modulesDir, names.plural.kebab);

    const moduleExists = yield* directoryExists(moduleDirectory);
    if (!moduleExists) {
      return yield* Effect.fail(
        new GeneratorError({
          message: `Module ${names.plural.kebab} does not exist at ${moduleDirectory}. Run \`generate module ${names.plural.kebab}\` first.`,
        }),
      );
    }

    const envDatabaseUrl = yield* readEnvDatabaseUrl(paths.workspaceRoot);
    const connectionString =
      options.databaseUrl ?? process.env['DATABASE_URL'] ?? envDatabaseUrl;

    if (!connectionString) {
      return yield* Effect.fail(
        new GeneratorError({
          message:
            'DATABASE_URL is not set. Pass --database-url or add it to .env at the workspace root.',
        }),
      );
    }

    yield* log(`Introspecting \`${names.plural.camel}\` table...`);
    const columns = yield* introspectTable(
      connectionString,
      names.plural.camel,
    );

    const subject = options.subject ?? names.singular.pascal;

    const writer = yield* createWriter({
      dryRun: options.dryRun ?? false,
      force: options.force ?? false,
      log,
    });

    yield* writer.writeFile(
      path.join(moduleDirectory, `${names.plural.kebab}.admin.ts`),
      adminTemplate({ names, columns, subject }),
    );
  }).pipe(
    Effect.mapError((error) =>
      error instanceof Error ? error : new Error(String(error)),
    ),
  );

export const generateAdmin = (options: GenerateAdminOptions): Promise<void> =>
  runGenerator(generateAdminEffect(options));

const readEnvDatabaseUrl = (
  workspaceRoot: string,
): Effect.Effect<
  string | undefined,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const envPath = path.join(workspaceRoot, '.env');
    const contents = yield* fs.readFileString(envPath).pipe(Effect.option);
    if (contents._tag === 'None') return;
    for (const line of contents.value.split(/\r?\n/)) {
      const match = /^\s*DATABASE_URL\s*=\s*(.+)$/.exec(line);
      if (match && match[1]) {
        return match[1].trim().replaceAll(/^["']|["']$/g, '');
      }
    }
    return;
  });

const moduleArgument = Args.text({ name: 'module' }).pipe(
  Args.withDescription('Target module name'),
);
const databaseUrlOption = Options.text('database-url').pipe(
  Options.withDescription(
    'Postgres connection string (defaults to DATABASE_URL or .env)',
  ),
  Options.optional,
);
const subjectOption = Options.text('subject').pipe(
  Options.withDescription(
    'Permission subject name (defaults to pascal singular module name)',
  ),
  Options.optional,
);
const dryRunOption = Options.boolean('dry-run').pipe(
  Options.withDescription("Print what would be written, don't touch disk"),
);
const forceOption = Options.boolean('force').pipe(
  Options.withDescription('Overwrite existing files'),
);

export const adminCommand = Command.make(
  'admin',
  {
    moduleName: moduleArgument,
    databaseUrl: databaseUrlOption,
    subject: subjectOption,
    dryRun: dryRunOption,
    force: forceOption,
  },
  ({ moduleName, databaseUrl, subject, dryRun, force }) =>
    generateAdminEffect({
      moduleName,
      ...(Option.isSome(databaseUrl) ? { databaseUrl: databaseUrl.value } : {}),
      ...(Option.isSome(subject) ? { subject: subject.value } : {}),
      dryRun,
      force,
    }),
).pipe(
  Command.withDescription(
    'Introspect the DB and emit a pre-filled <module>.admin.ts',
  ),
);
