import type { ModuleNames } from '../util/names.ts';

export const serviceTemplate = ({
  plural,
  singular,
}: ModuleNames): string => `import { ${singular.pascal}NotFound } from './errors/${singular.kebab}-not-found.error.ts';
import type { ${plural.pascal}Repository } from './${plural.kebab}.repository.ts';

interface ${plural.pascal}ServiceDeps {
  ${plural.camel}Repository: ${plural.pascal}Repository;
}

interface Create${singular.pascal}Input {
  name: string;
}

interface Update${singular.pascal}Input {
  name?: string;
}

export interface FindFilteredInput {
  page?: number;
  limit?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
}

export const create${plural.pascal}Service = ({
  ${plural.camel}Repository,
}: ${plural.pascal}ServiceDeps) => {
  return {
    findById: async (id: string) => {
      const ${singular.camel} = await ${plural.camel}Repository.findById(id);
      if (!${singular.camel}) throw new ${singular.pascal}NotFound(id);
      return ${singular.camel};
    },

    findFiltered: async (options: FindFilteredInput) => {
      return ${plural.camel}Repository.findFiltered(options);
    },

    create: async (input: Create${singular.pascal}Input) => {
      return ${plural.camel}Repository.create({ name: input.name });
    },

    update: async (id: string, data: Update${singular.pascal}Input) => {
      const ${singular.camel} = await ${plural.camel}Repository.update(id, {
        ...data,
        updatedAt: new Date().toISOString(),
      });
      if (!${singular.camel}) throw new ${singular.pascal}NotFound(id);
      return ${singular.camel};
    },

    deleteById: async (id: string) => {
      const ${singular.camel} = await ${plural.camel}Repository.deleteById(id);
      if (!${singular.camel}) throw new ${singular.pascal}NotFound(id);
      return ${singular.camel};
    },
  };
};

export type ${plural.pascal}Service = ReturnType<typeof create${plural.pascal}Service>;
`;
