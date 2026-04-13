/**
 * Allow-list URL protocols the admin panel will emit as-is. Everything
 * else (most importantly `javascript:` and `data:`) collapses to `fallback`.
 *
 * HTML escaping libraries don't handle protocol filtering on `href` /
 * `src` attributes -- that's on us. `preact-render-to-string` context-
 * aware escapes attribute values but will happily serialise
 * `href="javascript:alert(1)"` if you feed it one.
 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export const safeUrl = (input: string, fallback = '#'): string => {
  try {
    const u = new URL(input, 'https://placeholder.invalid');
    return SAFE_PROTOCOLS.has(u.protocol) ? input : fallback;
  } catch {
    return fallback;
  }
};
