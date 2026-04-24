/**
 * Integration test for `P1.gen.8`. Drives `generateModule` end-to-end into
 * a fresh temp workspace, verifies every expected file is produced, and
 * spot-checks that each rendered file contains the references needed for
 * `pnpm check-types` and `pnpm test` to pass.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateModule } from '../src/commands/generate-module.ts';

const MINIMAL_DB_SCHEMA = `import type { ColumnType, Generated } from 'kysely';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface DB {
  users: UsersTable;
}
`;

const GENERATED_MODULE_FILES = [
  'widgets.module.ts',
  'widgets.repository.ts',
  'widgets.service.ts',
  'widgets.mapper.ts',
  'widgets.route.ts',
  'schemas/widget-response.schema.ts',
  'schemas/create-widget.schema.ts',
  'schemas/update-widget.schema.ts',
  'errors/widget-not-found.error.ts',
  '__tests__/widgets.service.spec.ts',
  '__tests__/widgets.route.spec.ts',
];

describe('generateModule (integration)', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  const setupFixtureWorkspace = async () => {
    const workDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'generators-it-'),
    );
    cleanups.push(() => fs.rm(workDirectory, { recursive: true, force: true }));

    const apiService = path.join(workDirectory, 'services', 'api');
    await fs.mkdir(path.join(apiService, 'src', 'modules'), {
      recursive: true,
    });
    await fs.mkdir(path.join(apiService, 'src', 'db'), { recursive: true });
    await fs.mkdir(path.join(apiService, 'migrations'), { recursive: true });

    await fs.writeFile(
      path.join(workDirectory, 'pnpm-workspace.yaml'),
      "packages:\n  - 'services/*'\n",
    );
    await fs.writeFile(
      path.join(apiService, 'src', 'db', 'schema.ts'),
      MINIMAL_DB_SCHEMA,
    );

    return { workDirectory, apiService };
  };

  it('lays down every module file a fresh widgets module needs', async () => {
    const { workDirectory, apiService } = await setupFixtureWorkspace();

    await generateModule({
      name: 'widgets',
      workspaceRoot: workDirectory,
      log: () => {},
    });

    const moduleDirectory = path.join(apiService, 'src', 'modules', 'widgets');
    for (const relative of GENERATED_MODULE_FILES) {
      const absolute = path.join(moduleDirectory, relative);
      await expect(fs.access(absolute)).resolves.toBeUndefined();
    }
  });

  it('wires the new table into db/schema.ts (idempotently)', async () => {
    const { workDirectory, apiService } = await setupFixtureWorkspace();

    await generateModule({
      name: 'widgets',
      workspaceRoot: workDirectory,
      log: () => {},
    });

    const schema = await fs.readFile(
      path.join(apiService, 'src', 'db', 'schema.ts'),
      'utf8',
    );
    expect(schema).toContain('export interface WidgetsTable');
    expect(schema).toContain('widgets: WidgetsTable;');

    // Re-running the generator must be a no-op for the schema (force=true
    // lets module files re-emit; the schema patch is guarded by its
    // "already contains" check).
    await generateModule({
      name: 'widgets',
      workspaceRoot: workDirectory,
      force: true,
      log: () => {},
    });
    const schemaAfter = await fs.readFile(
      path.join(apiService, 'src', 'db', 'schema.ts'),
      'utf8',
    );
    const occurrences = schemaAfter.split('WidgetsTable').length - 1;
    expect(occurrences).toBe(schema.split('WidgetsTable').length - 1);
  });

  it('emits a migration file that creates and drops the widgets table', async () => {
    const { workDirectory, apiService } = await setupFixtureWorkspace();

    await generateModule({
      name: 'widgets',
      workspaceRoot: workDirectory,
      log: () => {},
    });

    const migrations = await fs.readdir(path.join(apiService, 'migrations'));
    const widgetMigration = migrations.find((f) =>
      f.endsWith('_create_widgets.ts'),
    );
    expect(widgetMigration).toBeDefined();

    const content = await fs.readFile(
      path.join(apiService, 'migrations', widgetMigration!),
      'utf8',
    );
    expect(content).toContain(`createTable('widgets')`);
    expect(content).toContain(`dropTable('widgets')`);
  });

  it('generated files reference each other with matching identifiers', async () => {
    const { workDirectory, apiService } = await setupFixtureWorkspace();

    await generateModule({
      name: 'blog-posts',
      workspaceRoot: workDirectory,
      log: () => {},
    });

    const moduleDirectory = path.join(
      apiService,
      'src',
      'modules',
      'blog-posts',
    );
    const service = await fs.readFile(
      path.join(moduleDirectory, 'blog-posts.service.ts'),
      'utf8',
    );
    expect(service).toContain('createBlogPostsService');
    expect(service).toContain('BlogPostNotFound');

    const route = await fs.readFile(
      path.join(moduleDirectory, 'blog-posts.route.ts'),
      'utf8',
    );
    expect(route).toContain("autoPrefix = '/blog-posts'");
    expect(route).toContain('blogPostsService');
    expect(route).toContain('blogPostsMapper');

    const module = await fs.readFile(
      path.join(moduleDirectory, 'blog-posts.module.ts'),
      'utf8',
    );
    expect(module).toContain('blogPostsRepository: BlogPostsRepository');
    expect(module).toContain('blogPostsService: BlogPostsService');
    expect(module).toContain('blogPostsMapper: BlogPostsMapper');
  });

  it('refuses to overwrite an existing module without --force', async () => {
    const { workDirectory, apiService } = await setupFixtureWorkspace();

    await fs.mkdir(path.join(apiService, 'src', 'modules', 'widgets'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(apiService, 'src', 'modules', 'widgets', 'widgets.module.ts'),
      '// pre-existing',
    );

    await expect(
      generateModule({
        name: 'widgets',
        workspaceRoot: workDirectory,
        log: () => {},
      }),
    ).rejects.toThrow(/already exists/);
  });
});
