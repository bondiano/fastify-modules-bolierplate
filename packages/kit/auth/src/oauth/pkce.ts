/**
 * PKCE (Proof Key for Code Exchange) per RFC 7636 + RFC 9700 BCP.
 *
 * `code_verifier`: 43-128 chars [A-Za-z0-9-._~]. We generate 32 random
 *   bytes and base64url-encode = 43 chars.
 * `code_challenge`: BASE64URL(SHA256(code_verifier)). The provider stores
 *   the challenge at `/authorize` time and matches the verifier sent
 *   to `/token`.
 */
import { createHash, randomBytes } from 'node:crypto';

const toBase64Url = (buffer: Buffer): string =>
  buffer
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

export const generateCodeVerifier = (): string => {
  const bytes = randomBytes(32);
  return toBase64Url(bytes);
};

export const deriveCodeChallenge = (verifier: string): string => {
  const hash = createHash('sha256').update(verifier).digest();
  return toBase64Url(hash);
};
