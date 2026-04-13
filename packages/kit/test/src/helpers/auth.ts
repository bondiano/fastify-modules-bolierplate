/**
 * Builds an Authorization Bearer header from an access token.
 */
export const buildAuthHeaders = (
  accessToken: string,
): Record<string, string> => ({
  Authorization: `Bearer ${accessToken}`,
});
