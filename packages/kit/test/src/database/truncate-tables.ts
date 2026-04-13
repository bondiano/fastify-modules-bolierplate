import { sql } from 'kysely';
import type { Kysely } from 'kysely';

/**
 * Truncates the given tables (or all non-system tables) with CASCADE.
 *
 * @param dataSource - Kysely instance
 * @param tables - Specific table names to truncate. When omitted, introspects
 *   the database and truncates every user table.
 */
export const truncateTables = async <DB>(
  dataSource: Kysely<DB>,
  tables?: readonly string[],
): Promise<void> => {
  const tableNames = tables ?? (await discoverTables(dataSource));

  if (tableNames.length === 0) return;

  const commaSeparatedTables = sql.join(
    tableNames.map((name) => sql.table(name)),
  );
  await sql`TRUNCATE ${commaSeparatedTables} CASCADE`.execute(dataSource);
};

const discoverTables = async <DB>(
  dataSource: Kysely<DB>,
): Promise<readonly string[]> => {
  const metadata = await dataSource.introspection.getTables();
  return metadata.map((table) => table.name);
};
