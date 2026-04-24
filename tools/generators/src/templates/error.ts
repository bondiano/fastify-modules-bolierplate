import type { ModuleNames } from '../util/names.ts';

export const notFoundErrorTemplate = ({
  singular,
}: ModuleNames): string => `import { defineDomainError } from '@kit/errors/domain';
import { NotFoundException } from '@kit/errors/exceptions';

export class ${singular.pascal}NotFound extends defineDomainError(
  '${singular.pascal}NotFound',
  NotFoundException,
) {
  readonly ${singular.camel}Id: string;

  constructor(${singular.camel}Id: string) {
    super(\`${singular.pascal} \${${singular.camel}Id} not found\`);
    this.${singular.camel}Id = ${singular.camel}Id;
  }
}
`;
