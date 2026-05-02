import { Type } from '@sinclair/typebox';

export const updateNoteBodySchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  content: Type.Optional(Type.String({ minLength: 1 })),
});
