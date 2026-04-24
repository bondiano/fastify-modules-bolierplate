import type { ModuleNames } from '../util/names.ts';

export const responseSchemaTemplate = ({
  singular,
}: ModuleNames): string => `import { Type } from '@sinclair/typebox';

import { softDeletableEntitySchema } from '@kit/schemas';

export const ${singular.camel}ResponseSchema = Type.Composite([
  softDeletableEntitySchema,
  Type.Object({
    name: Type.String(),
  }),
]);
`;

export const createBodySchemaTemplate = ({
  singular,
}: ModuleNames): string => `import { Type } from '@sinclair/typebox';

export const create${singular.pascal}BodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
});
`;

export const updateBodySchemaTemplate = ({
  singular,
}: ModuleNames): string => `import { Type } from '@sinclair/typebox';

export const update${singular.pascal}BodySchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
});
`;
