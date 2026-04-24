const splitWords = (input: string): string[] =>
  input
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

export const toKebabCase = (input: string): string =>
  splitWords(input).join('-');

export const toSnakeCase = (input: string): string =>
  splitWords(input).join('_');

export const toCamelCase = (input: string): string => {
  const words = splitWords(input);
  const [first, ...rest] = words;
  if (!first) return '';
  return first + rest.map((word) => capitalize(word)).join('');
};

export const toPascalCase = (input: string): string =>
  splitWords(input)
    .map((word) => capitalize(word))
    .join('');

export const toTitleCase = (input: string): string =>
  splitWords(input)
    .map((word) => capitalize(word))
    .join(' ');

export const toSingular = (input: string): string => {
  if (input.endsWith('ies') && input.length > 3)
    return input.slice(0, -3) + 'y';
  if (input.endsWith('ses') && input.length > 3) return input.slice(0, -2);
  if (input.endsWith('s') && !input.endsWith('ss') && input.length > 1) {
    return input.slice(0, -1);
  }
  return input;
};

const capitalize = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);
