import { randomBytes } from 'node:crypto';

import * as jose from 'jose';

import type { AuthConfig } from './config.js';
import { ExpiredTokenError, InvalidTokenError } from './errors.js';

export type TokenType = 'access' | 'refresh';

export interface AccessTokenPayload {
  sub: string;
  role: string;
  type: 'access';
  jti: string;
  iat: number;
}

export interface RefreshTokenPayload {
  sub: string;
  role: string;
  type: 'refresh';
  jti: string;
  iat: number;
}

export interface SignAccessTokenInput {
  userId: string;
  role: string;
}

export interface TokenService {
  signAccessToken(input: SignAccessTokenInput): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessTokenPayload>;
  signRefreshToken(input: SignAccessTokenInput): Promise<string>;
  verifyRefreshToken(token: string): Promise<RefreshTokenPayload>;
  /** Refresh token TTL in seconds (for blacklist key expiry). */
  readonly refreshTtlSeconds: number;
}

const ALG = 'HS256';

const parseTtlToSeconds = (ttl: string): number => {
  if (/^\d+$/.test(ttl)) return Number(ttl);
  const match = /^(\d+)([smhdw])$/.exec(ttl);
  if (!match) throw new Error(`Invalid TTL: ${ttl}`);
  const [, value, unit] = match;
  const factor = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 }[unit!]!;
  return Number(value) * factor;
};

/**
 * Fully stateless JWT token service. Both access and refresh tokens are
 * HS256 JWTs -- no DB storage. Revocation is handled externally via a
 * Redis blacklist (see `TokenBlacklistStore`).
 */
export const createTokenService = ({
  config,
}: {
  config: Pick<
    AuthConfig,
    'JWT_SECRET' | 'JWT_ISSUER' | 'ACCESS_TOKEN_TTL' | 'REFRESH_TOKEN_TTL'
  >;
}): TokenService => {
  const secret = new TextEncoder().encode(config.JWT_SECRET);
  const refreshTtlSeconds = parseTtlToSeconds(config.REFRESH_TOKEN_TTL);

  const signToken = async (
    { userId, role }: SignAccessTokenInput,
    type: TokenType,
    ttl: string,
  ): Promise<string> =>
    new jose.SignJWT({ role, type })
      .setProtectedHeader({ alg: ALG })
      .setIssuer(config.JWT_ISSUER)
      .setSubject(userId)
      .setIssuedAt()
      .setJti(randomBytes(16).toString('hex'))
      .setExpirationTime(ttl)
      .sign(secret);

  const verifyToken = async <
    T extends AccessTokenPayload | RefreshTokenPayload,
  >(
    token: string,
    expectedType: TokenType,
  ): Promise<T> => {
    try {
      const { payload } = await jose.jwtVerify(token, secret, {
        issuer: config.JWT_ISSUER,
      });
      if (payload.type !== expectedType || typeof payload.sub !== 'string') {
        throw new InvalidTokenError('Invalid token type');
      }
      return {
        sub: payload.sub,
        role: String(payload.role ?? 'user'),
        type: expectedType,
        jti: String(payload.jti ?? ''),
        iat: payload.iat ?? 0,
      } as T;
    } catch (error) {
      if (error instanceof InvalidTokenError) throw error;
      if ((error as { code?: string }).code === 'ERR_JWT_EXPIRED') {
        throw new ExpiredTokenError();
      }
      throw new InvalidTokenError();
    }
  };

  return {
    refreshTtlSeconds,

    signAccessToken: (input) =>
      signToken(input, 'access', config.ACCESS_TOKEN_TTL),
    verifyAccessToken: (token) =>
      verifyToken<AccessTokenPayload>(token, 'access'),

    signRefreshToken: (input) =>
      signToken(input, 'refresh', config.REFRESH_TOKEN_TTL),
    verifyRefreshToken: (token) =>
      verifyToken<RefreshTokenPayload>(token, 'refresh'),
  };
};
