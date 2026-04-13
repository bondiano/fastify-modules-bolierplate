import { Type } from '@sinclair/typebox';

import { baseEntitySchema, EmailString, StringEnum } from '@kit/schemas';

export const userResponseSchema = Type.Composite([
  baseEntitySchema,
  Type.Object({
    email: EmailString(),
    role: StringEnum(['admin', 'user']),
  }),
]);
