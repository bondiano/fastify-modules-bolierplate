import { Type } from '@sinclair/typebox';

import { StringEnum } from '@kit/schemas';

export const updatePostBodySchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  content: Type.Optional(Type.String({ minLength: 1 })),
  status: Type.Optional(StringEnum(['draft', 'published'])),
});
