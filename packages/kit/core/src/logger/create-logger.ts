import { pino, type Logger, type LoggerOptions } from 'pino';

export interface CreateLoggerOptions {
  name?: string;
  level?: LoggerOptions['level'];
  pretty?: boolean;
}

export const createLogger = (options: CreateLoggerOptions = {}): Logger => {
  const { name = 'app', level = 'info', pretty = false } = options;

  const baseOptions: LoggerOptions = { name, level };

  if (pretty) {
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      },
    });
  }

  return pino(baseOptions);
};
