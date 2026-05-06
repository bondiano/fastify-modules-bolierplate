/**
 * URL helpers for OAuth flows. `isReturnToAllowed` validates the
 * `returnTo` parameter so the callback redirect can't be turned into
 * an open-redirect (RFC 9700 §4.1.2.1).
 */

export interface ReturnToAllowlistOptions {
  /** Origin to allow (e.g. `https://app.example.com`). Required. */
  readonly origin: string;
  /** Optional explicit relative-path allowlist. When set, only paths in
   * the list pass; when omitted, any path on the matching origin passes. */
  readonly paths?: readonly string[];
}

export const isReturnToAllowed = (
  returnTo: string,
  options: ReturnToAllowlistOptions,
): boolean => {
  if (returnTo.startsWith('/')) {
    if (returnTo.startsWith('//')) return false; // protocol-relative
    if (options.paths && options.paths.length > 0) {
      return options.paths.some(
        (p) => returnTo === p || returnTo.startsWith(`${p}?`),
      );
    }
    return true;
  }
  try {
    const parsed = new URL(returnTo);
    if (parsed.origin !== options.origin) return false;
    if (options.paths && options.paths.length > 0) {
      return options.paths.some(
        (p) => parsed.pathname === p || parsed.pathname.startsWith(`${p}/`),
      );
    }
    return true;
  } catch {
    return false;
  }
};

/** Append `?key=value` query params to a URL while preserving any
 * existing query string. */
export const appendQueryParams = (
  url: string,
  params: Readonly<Record<string, string>>,
): string => {
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    u.searchParams.set(key, value);
  }
  return u.toString();
};
