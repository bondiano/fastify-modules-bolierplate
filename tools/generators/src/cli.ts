#!/usr/bin/env -S node --experimental-strip-types --no-warnings=ExperimentalWarning
import { Command } from '@effect/cli';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';

import { adminCommand } from './commands/generate-admin.ts';
import { jobCommand } from './commands/generate-job.ts';
import { migrationCommand } from './commands/generate-migration.ts';
import { moduleCommand } from './commands/generate-module.ts';

const generate = Command.make('generate').pipe(
  Command.withDescription('Fastify SaaS Kit code generators'),
  Command.withSubcommands([
    moduleCommand,
    migrationCommand,
    jobCommand,
    adminCommand,
  ]),
);

const cli = Command.run(generate, {
  name: 'Fastify SaaS Kit Generators',
  version: '0.0.0',
});

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);
