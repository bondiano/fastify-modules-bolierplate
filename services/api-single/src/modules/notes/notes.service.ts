import { NoteNotFound } from './errors/note-not-found.error.ts';
import type { NotesRepository } from './notes.repository.ts';

interface NotesServiceDeps {
  notesRepository: NotesRepository;
}

interface CreateNoteInput {
  title: string;
  content: string;
}

interface UpdateNoteInput {
  title?: string;
  content?: string;
}

export const createNotesService = ({ notesRepository }: NotesServiceDeps) => ({
  findById: async (id: string) => {
    const note = await notesRepository.findById(id);
    if (!note) throw new NoteNotFound(id);
    return note;
  },

  findPaginated: async (page: number, limit: number) =>
    notesRepository.findPaginatedByPage({
      page,
      limit,
      orderByField: 'createdAt',
      orderByDirection: 'desc',
    }),

  create: async (input: CreateNoteInput) =>
    notesRepository.create({
      title: input.title,
      content: input.content,
    }),

  update: async (id: string, data: UpdateNoteInput) => {
    const note = await notesRepository.update(id, {
      ...data,
      updatedAt: new Date().toISOString(),
    });
    if (!note) throw new NoteNotFound(id);
    return note;
  },

  deleteById: async (id: string) => {
    const note = await notesRepository.deleteById(id);
    if (!note) throw new NoteNotFound(id);
    return note;
  },
});

export type NotesService = ReturnType<typeof createNotesService>;
