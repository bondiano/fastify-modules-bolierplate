import { Args, Command, Options } from '@effect/cli';
import type { FileSystem } from '@effect/platform';
import { Path } from '@effect/platform';
import { Console, Effect, Option } from 'effect';

import { jobTemplate } from '../templates/job.ts';
import { toKebabCase } from '../util/case.ts';
import { GeneratorError } from '../util/errors.ts';
import { resolvePaths } from '../util/paths.ts';
import { runGenerator } from '../util/runtime.ts';
import { createWriter, directoryExists } from '../util/writer.ts';

export interface GenerateJobOptions {
  readonly moduleName: string;
  readonly jobName: string;
  readonly queue?: string;
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly log?: (message: string) => void;
}

export const generateJobEffect = (
  options: GenerateJobOptions,
): Effect.Effect<void, Error, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const userLog = options.log;
    const log = userLog
      ? (message: string) => Effect.sync(() => userLog(message))
      : (message: string) => Console.log(message);

    const moduleKebab = toKebabCase(options.moduleName);
    const jobKebab = toKebabCase(options.jobName);
    const queueKebab = toKebabCase(options.queue ?? moduleKebab);

    if (!moduleKebab || !jobKebab) {
      return yield* Effect.fail(
        new GeneratorError({
          message: 'Module and job name must be non-empty',
        }),
      );
    }

    const paths = yield* resolvePaths();
    const moduleDirectory = path.join(paths.modulesDir, moduleKebab);

    const moduleExists = yield* directoryExists(moduleDirectory);
    if (!moduleExists) {
      return yield* Effect.fail(
        new GeneratorError({
          message: `Module ${moduleKebab} does not exist at ${moduleDirectory}. Run \`generate module ${moduleKebab}\` first.`,
        }),
      );
    }

    const jobPath = path.join(
      moduleDirectory,
      'jobs',
      queueKebab,
      `${jobKebab}.job.ts`,
    );

    const writer = yield* createWriter({
      dryRun: options.dryRun ?? false,
      force: options.force ?? false,
      log,
    });

    yield* writer.writeFile(
      jobPath,
      jobTemplate({
        moduleName: moduleKebab,
        jobName: jobKebab,
        queueName: queueKebab,
      }),
    );
  }).pipe(
    Effect.mapError((error) =>
      error instanceof Error ? error : new Error(String(error)),
    ),
  );

export const generateJob = (options: GenerateJobOptions): Promise<void> =>
  runGenerator(generateJobEffect(options));

const moduleArgument = Args.text({ name: 'module' }).pipe(
  Args.withDescription('Target module name (e.g. users)'),
);
const jobNameArgument = Args.text({ name: 'job-name' }).pipe(
  Args.withDescription('Job name (e.g. send-welcome-email)'),
);
const queueOption = Options.text('queue').pipe(
  Options.withDescription('Override the queue name (defaults to module name)'),
  Options.optional,
);
const dryRunOption = Options.boolean('dry-run').pipe(
  Options.withDescription("Print what would be written, don't touch disk"),
);
const forceOption = Options.boolean('force').pipe(
  Options.withDescription('Overwrite existing files'),
);

export const jobCommand = Command.make(
  'job',
  {
    moduleName: moduleArgument,
    jobName: jobNameArgument,
    queue: queueOption,
    dryRun: dryRunOption,
    force: forceOption,
  },
  ({ moduleName, jobName, queue, dryRun, force }) =>
    generateJobEffect({
      moduleName,
      jobName,
      ...(Option.isSome(queue) ? { queue: queue.value } : {}),
      dryRun,
      force,
    }),
).pipe(Command.withDescription('Scaffold a BullMQ job for an existing module'));
