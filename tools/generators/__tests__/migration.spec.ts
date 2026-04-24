import { describe, expect, it } from 'vitest';

import {
  createTableMigrationTemplate,
  emptyMigrationTemplate,
  migrationTimestamp,
  sanitizeMigrationName,
} from '../src/templates/migration.ts';

describe('migration templates', () => {
  describe('sanitizeMigrationName', () => {
    it('keeps alphanumeric characters and lowercases the input', () => {
      expect(sanitizeMigrationName('CreateWidgets')).toBe('createwidgets');
    });

    it('replaces any run of non-alphanumeric characters with a single underscore', () => {
      expect(sanitizeMigrationName('add widget price column')).toBe(
        'add_widget_price_column',
      );
      expect(sanitizeMigrationName('add-widget-price')).toBe(
        'add_widget_price',
      );
    });

    it('strips leading and trailing underscores', () => {
      expect(sanitizeMigrationName('__foo__')).toBe('foo');
    });

    it('rejects names without alphanumeric characters', () => {
      expect(() => sanitizeMigrationName('___')).toThrow(/alphanumeric/);
    });
  });

  describe('migrationTimestamp', () => {
    it('produces YYYYMMDDhhmmss for a fixed clock', () => {
      const fixed = new Date('2026-04-24T17:00:45.123Z');
      expect(migrationTimestamp(fixed)).toBe('20260424170045');
    });
  });

  it('empty migration template has up/down exports', () => {
    const content = emptyMigrationTemplate();
    expect(content).toContain('export async function up');
    expect(content).toContain('export async function down');
  });

  it('create-table migration template creates and drops the table', () => {
    const content = createTableMigrationTemplate('widgets');
    expect(content).toContain(`createTable('widgets')`);
    expect(content).toContain(`dropTable('widgets')`);
    expect(content).toContain('gen_random_uuid()');
  });
});
