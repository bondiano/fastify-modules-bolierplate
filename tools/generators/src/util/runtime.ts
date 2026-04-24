import type { FileSystem, Path } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';

/**
 * Run a generator effect against the Node platform layers and return a
 * Promise. Used by integration tests and the test-friendly wrappers
 * exported from each `generate-*` command module.
 */
export const runGenerator = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));
