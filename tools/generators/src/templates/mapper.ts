import type { ModuleNames } from '../util/names.ts';

export const mapperTemplate = ({
  plural,
  singular,
}: ModuleNames): string => `import type { Selectable } from 'kysely';

import type { DB } from '#db/schema.ts';

export interface ${singular.pascal}Response {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const create${plural.pascal}Mapper = () => ({
  toResponse: (
    ${singular.camel}: Selectable<DB['${plural.camel}']>,
  ): ${singular.pascal}Response => ({
    id: ${singular.camel}.id,
    name: ${singular.camel}.name,
    createdAt:
      ${singular.camel}.createdAt instanceof Date
        ? ${singular.camel}.createdAt.toISOString()
        : String(${singular.camel}.createdAt),
    updatedAt:
      ${singular.camel}.updatedAt instanceof Date
        ? ${singular.camel}.updatedAt.toISOString()
        : String(${singular.camel}.updatedAt),
    deletedAt:
      ${singular.camel}.deletedAt instanceof Date
        ? ${singular.camel}.deletedAt.toISOString()
        : ${singular.camel}.deletedAt
          ? String(${singular.camel}.deletedAt)
          : null,
  }),
});

export type ${plural.pascal}Mapper = ReturnType<typeof create${plural.pascal}Mapper>;
`;
