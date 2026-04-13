import {
  CamelCasePlugin,
  DeduplicateJoinsPlugin,
  Kysely,
  PostgresDialect,
  type KyselyPlugin,
} from 'kysely';
import pg from 'pg';
import Cursor from 'pg-cursor';
import type { Logger } from 'pino';

export interface CreateDataSourceOptions {
  logger: Pick<Logger, 'info' | 'error' | 'debug'>;
  connectionString: string;
  maxConnections?: number;
  /** When true, logs every successful query with duration + params. */
  logQueries?: boolean;
  /** Extra Kysely plugins appended after the defaults. */
  plugins?: KyselyPlugin[];
}

/**
 * Creates a Kysely data source (PostgreSQL) with sensible defaults:
 * - PostgresDialect with a pg Pool
 * - pg-cursor for streaming support
 * - DeduplicateJoinsPlugin + CamelCasePlugin
 * - pino-backed query logging (errors always, info when logQueries=true)
 *
 * The generic `DB` parameter is the Kysely schema interface you generated
 * (typically via `kysely-codegen`) from your database.
 */
export function createDataSource<DB>({
  logger,
  connectionString,
  maxConnections = 10,
  logQueries = false,
  plugins = [],
}: CreateDataSourceOptions): Kysely<DB> {
  const dialect = new PostgresDialect({
    pool: new pg.Pool({ connectionString, max: maxConnections }),
    cursor: Cursor,
  });

  return new Kysely<DB>({
    dialect,
    plugins: [new DeduplicateJoinsPlugin(), new CamelCasePlugin(), ...plugins],
    log(event) {
      if (event.level === 'error') {
        logger.error(
          {
            durationMs: event.queryDurationMillis,
            error: event.error,
            sql: event.query.sql,
            params: event.query.parameters,
          },
          'Query failed',
        );
        return;
      }

      if (logQueries) {
        logger.info(
          {
            durationMs: event.queryDurationMillis,
            sql: event.query.sql,
            params: event.query.parameters,
          },
          'Query executed',
        );
      }
    },
  });
}

export function closeDataSource<DB>(dataSource: Kysely<DB>): Promise<void> {
  return dataSource.destroy();
}
