import { Buffer } from 'node:buffer';

import { CamelCasePlugin, DeduplicateJoinsPlugin, Kysely } from 'kysely';
import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from 'kysely';
import { KyselyPGlite } from 'kysely-pglite';

/**
 * Converts PGlite's Uint8Array binary values to Node Buffer
 * for compatibility with pg driver behavior.
 */
class BinaryTransformPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  }

  async transformResult(
    args: PluginTransformResultArgs,
  ): Promise<QueryResult<UnknownRow>> {
    if (!args.result.rows) {
      return args.result;
    }

    return {
      ...args.result,
      rows: args.result.rows.map((row) => {
        for (const key in row) {
          if (row[key] instanceof Uint8Array) {
            row[key] = Buffer.from(row[key]);
          }
        }
        return row;
      }),
    };
  }
}

export interface CreateTestDataSourceOptions {
  /** Extra Kysely plugins appended after the defaults. */
  readonly plugins?: readonly KyselyPlugin[];
}

/**
 * Creates an in-memory PGlite-backed Kysely data source for testing.
 *
 * Includes the same default plugins as the production data source
 * (DeduplicateJoins + CamelCase) plus a BinaryTransform plugin
 * for Uint8Array -> Buffer compatibility.
 */
export const createTestDataSource = async <DB>(
  options: CreateTestDataSourceOptions = {},
): Promise<Kysely<DB>> => {
  const { plugins = [] } = options;

  const { dialect } = await KyselyPGlite.create();

  return new Kysely<DB>({
    dialect,
    plugins: [
      new DeduplicateJoinsPlugin(),
      new CamelCasePlugin(),
      new BinaryTransformPlugin(),
      ...plugins,
    ],
  });
};
