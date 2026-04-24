import { Effect } from 'effect';
import pg from 'pg';

import type { InferredColumn } from '../templates/admin.ts';

import { GeneratorError } from './errors.ts';

const { Client } = pg;

interface InformationSchemaRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
  udt_name: string;
}

/**
 * Query `information_schema.columns` for `tableName` in the current schema,
 * returning a camelCase-ified column list for the admin template.
 */
export const introspectTable = (
  connectionString: string,
  tableName: string,
): Effect.Effect<readonly InferredColumn[], GeneratorError> =>
  Effect.tryPromise({
    try: async () => {
      const client = new Client({ connectionString });
      await client.connect();
      try {
        const { rows } = await client.query<InformationSchemaRow>(
          `
            SELECT column_name, data_type, is_nullable, column_default, udt_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = $1
            ORDER BY ordinal_position
          `,
          [tableName],
        );

        if (rows.length === 0) {
          throw new Error(
            `Table "${tableName}" not found in the current schema. Run \`pnpm --filter api db:migrate\` first.`,
          );
        }

        return rows.map(
          (row): InferredColumn => ({
            name: snakeToCamel(row.column_name),
            dataType: row.data_type,
            isNullable: row.is_nullable === 'YES',
            defaultValue: row.column_default,
            udtName: row.udt_name,
          }),
        );
      } finally {
        await client.end();
      }
    },
    catch: (error) =>
      new GeneratorError({
        message: error instanceof Error ? error.message : String(error),
      }),
  });

const snakeToCamel = (input: string): string =>
  input.replaceAll(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
