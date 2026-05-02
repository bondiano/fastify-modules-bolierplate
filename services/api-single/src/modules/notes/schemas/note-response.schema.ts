import { Type } from '@sinclair/typebox';

import { softDeletableEntitySchema } from '@kit/schemas';

export const noteResponseSchema = Type.Composite([
  softDeletableEntitySchema,
  Type.Object({
    title: Type.String(),
    content: Type.String(),
  }),
]);
