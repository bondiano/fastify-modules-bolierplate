import { Type } from '@sinclair/typebox';

import { EmailString, StringEnum } from '@kit/schemas';

export const updateUserBodySchema = Type.Object({
  email: Type.Optional(EmailString()),
  role: Type.Optional(StringEnum(['admin', 'user'])),
});
