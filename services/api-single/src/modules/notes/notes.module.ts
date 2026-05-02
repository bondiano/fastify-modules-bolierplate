import type { DB } from '#db/schema.ts';
import type { Trx } from '@kit/db/transaction';

import type { NotesMapper } from './notes.mapper.ts';
import type { NotesRepository } from './notes.repository.ts';
import type { NotesService } from './notes.service.ts';

declare global {
  interface Dependencies {
    transaction: Trx<DB>;
    notesRepository: NotesRepository;
    notesService: NotesService;
    notesMapper: NotesMapper;
  }
}
