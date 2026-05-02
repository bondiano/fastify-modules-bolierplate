import type { ColumnType, Generated } from 'kysely';

export interface NotesTable {
  id: Generated<string>;
  title: string;
  content: string;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
  deletedAt: ColumnType<Date | null, string | null | undefined, string | null>;
}

export interface DB {
  notes: NotesTable;
}
