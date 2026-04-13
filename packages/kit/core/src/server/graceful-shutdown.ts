import type { Logger } from '../logger/index.js';

const FORCE_EXIT_TIMEOUT_MS = 20_000;
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGQUIT'] as const;

export type ShutdownSignal = (typeof SIGNALS)[number];
export type ShutdownCallback = (signal: ShutdownSignal) => Promise<void> | void;

/**
 * Register SIGINT/SIGTERM/SIGQUIT handlers that invoke the callback once,
 * with a hard-exit safety net if shutdown stalls.
 */
export const setupGracefulShutdown = (
  callback: ShutdownCallback,
  logger?: Pick<Logger, 'info' | 'error'>,
): void => {
  let called = false;

  const handler = (signal: ShutdownSignal) => async () => {
    if (called) return;
    called = true;

    const forceExit = setTimeout(() => {
      logger?.error(
        `Force closing application after ${FORCE_EXIT_TIMEOUT_MS / 1000}s of inactivity.`,
      );
      process.exit(1);
    }, FORCE_EXIT_TIMEOUT_MS);
    forceExit.unref();

    try {
      logger?.info(`Received ${signal}, shutting down gracefully...`);
      await callback(signal);
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger?.error(error as Error);
      process.exit(1);
    }
  };

  for (const signal of SIGNALS) {
    process.removeAllListeners(signal).on(signal, handler(signal));
  }
};
