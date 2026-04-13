/**
 * Convert an auto-loaded module filename into a camelCase Awilix cradle key.
 *
 * Examples:
 *   users.repository          -> usersRepository
 *   merchant-mids.repository  -> merchantMidsRepository
 *   tokens.async-service      -> tokensService
 *   api.client                -> apiClient
 */
export const formatName = (fileName: string): string => {
  const parts = fileName
    .split(/[.-]/)
    .filter((part) => part.length > 0 && part !== 'async');

  return parts
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('');
};
