import { Type } from '@sinclair/typebox';

export const createNoteBodySchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 500 }),
  content: Type.String({ minLength: 1 }),
});
