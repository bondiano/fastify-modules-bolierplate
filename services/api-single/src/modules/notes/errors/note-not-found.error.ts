import { defineDomainError } from '@kit/errors/domain';
import { NotFoundException } from '@kit/errors/exceptions';

export class NoteNotFound extends defineDomainError(
  'NoteNotFound',
  NotFoundException,
) {
  readonly noteId: string;

  constructor(noteId: string) {
    super(`Note ${noteId} not found`);
    this.noteId = noteId;
  }
}
