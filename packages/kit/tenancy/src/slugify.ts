/**
 * Minimal ASCII slugifier. Lowercases, decomposes accented characters,
 * strips combining marks, collapses any remaining non-alphanumerics to
 * dashes, trims edge dashes, and caps length (defaulting to 63 -- typical
 * hostname/subdomain limit). Falls back to `'tenant'` when the input
 * contains no alphanumerics so `create` never has to produce an empty slug.
 */
export const MAX_SLUG_LENGTH = 63;
const FALLBACK_SLUG = 'tenant';

export interface SlugifyOptions {
  /** Override the default 63-char hostname cap. */
  readonly maxLength?: number;
}

export const slugify = (
  input: string,
  options: SlugifyOptions = {},
): string => {
  const maxLength = options.maxLength ?? MAX_SLUG_LENGTH;
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/\p{M}+/gu, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, maxLength);
  return base.length > 0 ? base : FALLBACK_SLUG;
};
