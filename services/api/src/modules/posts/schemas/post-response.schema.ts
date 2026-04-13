import { Type } from '@sinclair/typebox';

import { softDeletableEntitySchema, StringEnum } from '@kit/schemas';

export const postResponseSchema = Type.Composite([
  softDeletableEntitySchema,
  Type.Object({
    title: Type.String(),
    content: Type.String(),
    status: StringEnum(['draft', 'published']),
    authorId: Type.String(),
  }),
]);
