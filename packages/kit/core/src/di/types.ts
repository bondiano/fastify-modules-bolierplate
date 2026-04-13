import type { AwilixContainer } from 'awilix';

import type { Logger } from '../logger/index.js';

/**
 * A function that registers services into the DI container.
 * Kit packages export provider factories (e.g. `authProvider(opts)`) that
 * return a `ContainerProvider`. The consuming app passes them to
 * `createContainer({ providers: [...] })`.
 */
export type ContainerProvider = (
  container: AwilixContainer,
) => void | Promise<void>;

declare global {
  /**
   * Global DI cradle type. Consumers extend this interface per-module to
   * register their services for end-to-end type safety.
   *
   * @example
   * // modules/users/users.module.ts
   * declare global {
   *   interface Dependencies {
   *     usersRepository: ReturnType<typeof createUsersRepository>;
   *     usersService: ReturnType<typeof createUsersService>;
   *   }
   * }
   */
  interface Dependencies {
    logger: Logger;
    config: Record<string, unknown>;
  }
}

declare module '@fastify/awilix' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Cradle extends Dependencies {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface RequestCradle extends Dependencies {}
}
