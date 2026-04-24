import { Args, Command, Options } from '@effect/cli';
import { FileSystem, Path } from '@effect/platform';
import { Console, Effect } from 'effect';

import { notFoundErrorTemplate } from '../templates/error.ts';
import { mapperTemplate } from '../templates/mapper.ts';
import {
  createTableMigrationTemplate,
  migrationTimestamp,
} from '../templates/migration.ts';
import { moduleTemplate } from '../templates/module.ts';
import { repositoryTemplate } from '../templates/repository.ts';
import { routeTemplate } from '../templates/route.ts';
import {
  createBodySchemaTemplate,
  responseSchemaTemplate,
  updateBodySchemaTemplate,
} from '../templates/schemas.ts';
import { serviceTemplate } from '../templates/service.ts';
import { routeSpecTemplate, serviceSpecTemplate } from '../templates/tests.ts';
import { GeneratorError } from '../util/errors.ts';
import { buildModuleNames, type ModuleNames } from '../util/names.ts';
import { resolvePaths } from '../util/paths.ts';
import { runGenerator } from '../util/runtime.ts';
import { createWriter, directoryExists, type Writer } from '../util/writer.ts';

export interface GenerateModuleOptions {
  readonly name: string;
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly skipMigration?: boolean;
  readonly skipSchemaUpdate?: boolean;
  readonly workspaceRoot?: string;
  readonly log?: (message: string) => void;
}

export const generateModuleEffect = (
  options: GenerateModuleOptions,
): Effect.Effect<void, Error, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const userLog = options.log;
    const log = userLog
      ? (message: string) => Effect.sync(() => userLog(message))
      : (message: string) => Console.log(message);

    const names = buildModuleNames(options.name);
    if (!names.plural.kebab) {
      return yield* Effect.fail(
        new GeneratorError({
          message:
            'Module name must contain at least one alphanumeric character',
        }),
      );
    }

    const paths = yield* resolvePaths(
      options.workspaceRoot === undefined
        ? {}
        : { workspaceRoot: options.workspaceRoot },
    );
    const moduleDirectory = path.join(paths.modulesDir, names.plural.kebab);

    const alreadyThere = yield* directoryExists(moduleDirectory);
    if (alreadyThere && !options.force) {
      return yield* Effect.fail(
        new GeneratorError({
          message: `Module directory ${moduleDirectory} already exists. Pass --force to overwrite.`,
        }),
      );
    }

    const writer = yield* createWriter({
      dryRun: options.dryRun ?? false,
      force: options.force ?? false,
      log,
    });

    yield* log(`Generating module ${names.plural.kebab} at ${moduleDirectory}`);

    yield* writeModuleFiles({ writer, moduleDirectory, names });

    if (!options.skipSchemaUpdate) {
      yield* patchDbSchema({
        schemaPath: path.join(paths.apiService, 'src', 'db', 'schema.ts'),
        names,
        dryRun: options.dryRun ?? false,
        log,
      });
    }

    if (!options.skipMigration) {
      const timestamp = migrationTimestamp();
      const migrationPath = path.join(
        paths.migrationsDir,
        `${timestamp}_create_${names.plural.camel}.ts`,
      );
      yield* writer.writeFile(
        migrationPath,
        createTableMigrationTemplate(names.plural.camel),
      );
    }

    yield* log('');
    const written = yield* writer.written;
    const nonSkipped = written.filter((f) => f.status !== 'skipped').length;
    yield* log(`Done. ${nonSkipped} file(s) written.`);
  }).pipe(
    Effect.mapError((error) =>
      error instanceof Error ? error : new Error(String(error)),
    ),
  );

/**
 * Promise-based wrapper used by integration tests. Runs the effect against the
 * Node platform layers.
 */
export const generateModule = (options: GenerateModuleOptions): Promise<void> =>
  runGenerator(generateModuleEffect(options));

interface WriteModuleFilesInput {
  readonly writer: Writer;
  readonly moduleDirectory: string;
  readonly names: ModuleNames;
}

const writeModuleFiles = ({
  writer,
  moduleDirectory,
  names,
}: WriteModuleFilesInput): Effect.Effect<
  void,
  Error,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const { plural, singular } = names;

    const files = [
      [
        path.join(moduleDirectory, `${plural.kebab}.module.ts`),
        moduleTemplate(names),
      ],
      [
        path.join(moduleDirectory, `${plural.kebab}.repository.ts`),
        repositoryTemplate(names),
      ],
      [
        path.join(moduleDirectory, `${plural.kebab}.service.ts`),
        serviceTemplate(names),
      ],
      [
        path.join(moduleDirectory, `${plural.kebab}.mapper.ts`),
        mapperTemplate(names),
      ],
      [
        path.join(moduleDirectory, `${plural.kebab}.route.ts`),
        routeTemplate(names),
      ],
      [
        path.join(
          moduleDirectory,
          'schemas',
          `${singular.kebab}-response.schema.ts`,
        ),
        responseSchemaTemplate(names),
      ],
      [
        path.join(
          moduleDirectory,
          'schemas',
          `create-${singular.kebab}.schema.ts`,
        ),
        createBodySchemaTemplate(names),
      ],
      [
        path.join(
          moduleDirectory,
          'schemas',
          `update-${singular.kebab}.schema.ts`,
        ),
        updateBodySchemaTemplate(names),
      ],
      [
        path.join(
          moduleDirectory,
          'errors',
          `${singular.kebab}-not-found.error.ts`,
        ),
        notFoundErrorTemplate(names),
      ],
      [
        path.join(
          moduleDirectory,
          '__tests__',
          `${plural.kebab}.service.spec.ts`,
        ),
        serviceSpecTemplate(names),
      ],
      [
        path.join(
          moduleDirectory,
          '__tests__',
          `${plural.kebab}.route.spec.ts`,
        ),
        routeSpecTemplate(names),
      ],
    ] as const;

    for (const [filePath, content] of files) {
      yield* writer.writeFile(filePath, content);
    }
  });

interface PatchDbSchemaInput {
  readonly schemaPath: string;
  readonly names: ModuleNames;
  readonly dryRun: boolean;
  readonly log: (message: string) => Effect.Effect<void>;
}

/**
 * Appends a new Kysely table interface and DB key for the generated module
 * if the schema file doesn't already reference the table. Idempotent: a
 * second run is a no-op.
 */
const patchDbSchema = ({
  schemaPath,
  names,
  dryRun,
  log,
}: PatchDbSchemaInput): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const existing = yield* fs.readFileString(schemaPath);

    const tableInterfaceName = `${names.plural.pascal}Table`;
    const tableKey = names.plural.camel;

    if (existing.includes(`interface ${tableInterfaceName}`)) {
      yield* log(
        `  skip    ${schemaPath} (already contains ${tableInterfaceName})`,
      );
      return;
    }

    const dbAnchor = 'export interface DB {';
    const dbStartIndex = existing.indexOf(dbAnchor);
    if (dbStartIndex === -1) {
      return yield* Effect.fail(
        new GeneratorError({
          message: `Could not locate \`export interface DB {\` in ${schemaPath}`,
        }),
      );
    }
    const dbEndIndex = existing.indexOf('}', dbStartIndex);
    if (dbEndIndex === -1) {
      return yield* Effect.fail(
        new GeneratorError({
          message: `Could not find closing brace of \`DB\` interface in ${schemaPath}`,
        }),
      );
    }

    const newInterface = `export interface ${tableInterfaceName} {
  id: Generated<string>;
  name: string;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
  deletedAt: ColumnType<Date | null, string | null | undefined, string | null>;
}

`;

    const dbBody = existing.slice(dbStartIndex + dbAnchor.length, dbEndIndex);
    const dbBodyTrimmed = dbBody.trimEnd();
    const newDbBody = `${dbBodyTrimmed}\n  ${tableKey}: ${tableInterfaceName};\n`;

    const patchedDb =
      existing.slice(0, dbStartIndex) +
      newInterface +
      `${dbAnchor}${newDbBody}` +
      existing.slice(dbEndIndex);

    if (dryRun) {
      yield* log(
        `  dry     ${schemaPath} (would append ${tableInterfaceName})`,
      );
      return;
    }

    yield* fs.writeFileString(schemaPath, patchedDb);
    yield* log(`  update  ${schemaPath}`);
  }).pipe(
    Effect.mapError((error) =>
      error instanceof Error ? error : new Error(String(error)),
    ),
  );

const nameArgument = Args.text({ name: 'name' }).pipe(
  Args.withDescription('Module name (e.g. blog-posts)'),
);
const dryRunOption = Options.boolean('dry-run').pipe(
  Options.withDescription("Print what would be written, don't touch disk"),
);
const forceOption = Options.boolean('force').pipe(
  Options.withDescription('Overwrite existing files'),
);
const skipMigrationOption = Options.boolean('skip-migration').pipe(
  Options.withDescription('Do not emit a create-table migration'),
);
const skipSchemaUpdateOption = Options.boolean('skip-schema-update').pipe(
  Options.withDescription('Do not patch services/api/src/db/schema.ts'),
);

export const moduleCommand = Command.make(
  'module',
  {
    name: nameArgument,
    dryRun: dryRunOption,
    force: forceOption,
    skipMigration: skipMigrationOption,
    skipSchemaUpdate: skipSchemaUpdateOption,
  },
  ({ name, dryRun, force, skipMigration, skipSchemaUpdate }) =>
    generateModuleEffect({
      name,
      dryRun,
      force,
      skipMigration,
      skipSchemaUpdate,
    }),
).pipe(
  Command.withDescription(
    'Scaffold a Fastify module (repo/service/route/mapper/schemas/errors/tests)',
  ),
);
