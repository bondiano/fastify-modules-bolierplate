import {
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toSingular,
  toTitleCase,
} from './case.ts';

/**
 * A unified bundle of naming variants used across the module templates.
 *
 * Example for input `blog-posts`:
 *   plural:       { kebab: blog-posts, camel: blogPosts, pascal: BlogPosts, title: "Blog Posts" }
 *   singular:     { kebab: blog-post,  camel: blogPost,  pascal: BlogPost,  title: "Blog Post"  }
 */
export interface ModuleNames {
  readonly plural: NameVariants;
  readonly singular: NameVariants;
}

export interface NameVariants {
  readonly kebab: string;
  readonly camel: string;
  readonly pascal: string;
  readonly title: string;
}

const variantsOf = (raw: string): NameVariants => ({
  kebab: toKebabCase(raw),
  camel: toCamelCase(raw),
  pascal: toPascalCase(raw),
  title: toTitleCase(raw),
});

export const buildModuleNames = (raw: string): ModuleNames => {
  const pluralKebab = toKebabCase(raw);
  const singularKebab = toSingular(pluralKebab);
  return {
    plural: variantsOf(pluralKebab),
    singular: variantsOf(singularKebab),
  };
};
