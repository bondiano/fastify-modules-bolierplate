import type { Selectable } from 'kysely';

import type { DB } from '#db/schema.ts';

export interface NoteResponse {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

const toIsoString = (value: Date | string | null): string | null => {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

export const createNotesMapper = () => ({
  toResponse: (note: Selectable<DB['notes']>): NoteResponse => ({
    id: note.id,
    title: note.title,
    content: note.content,
    createdAt: toIsoString(note.createdAt) ?? '',
    updatedAt: toIsoString(note.updatedAt) ?? '',
    deletedAt: toIsoString(note.deletedAt),
  }),
});

export type NotesMapper = ReturnType<typeof createNotesMapper>;
