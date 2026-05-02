import type { DB } from '#db/schema.ts';
import { createSoftDeleteRepository } from '@kit/db/runtime';
import type { Trx } from '@kit/db/transaction';

interface NotesRepositoryDeps {
  transaction: Trx<DB>;
}

export const createNotesRepository = ({ transaction }: NotesRepositoryDeps) =>
  createSoftDeleteRepository<DB, 'notes'>(transaction, 'notes');

export type NotesRepository = ReturnType<typeof createNotesRepository>;
