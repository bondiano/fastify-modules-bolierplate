import { Type } from '@sinclair/typebox';

import { StringEnum } from '@kit/schemas';

export const createPostBodySchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 500 }),
  content: Type.String({ minLength: 1 }),
  status: Type.Optional(StringEnum(['draft', 'published'])),
});
