import type { ModuleNames } from '../util/names.ts';

export const moduleTemplate = ({
  plural,
}: ModuleNames): string => `import type { ${plural.pascal}Mapper } from './${plural.kebab}.mapper.ts';
import type { ${plural.pascal}Repository } from './${plural.kebab}.repository.ts';
import type { ${plural.pascal}Service } from './${plural.kebab}.service.ts';

declare global {
  interface Dependencies {
    ${plural.camel}Repository: ${plural.pascal}Repository;
    ${plural.camel}Service: ${plural.pascal}Service;
    ${plural.camel}Mapper: ${plural.pascal}Mapper;
  }
}
`;
