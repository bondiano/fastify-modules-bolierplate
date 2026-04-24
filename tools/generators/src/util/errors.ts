import { Data } from 'effect';

export class GeneratorError extends Data.TaggedError('GeneratorError')<{
  readonly message: string;
}> {}

export class WorkspaceNotFoundError extends Data.TaggedError(
  'WorkspaceNotFoundError',
)<{
  readonly startDirectory: string;
}> {
  override get message(): string {
    return `Unable to locate pnpm-workspace.yaml starting from ${this.startDirectory}`;
  }
}
