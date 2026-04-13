import { describe, expect, it } from 'vitest';

import { ExpiredTokenError, InvalidTokenError } from './errors.js';
import { createTokenService } from './tokens.js';

const config = {
  JWT_SECRET: 'a'.repeat(48),
  JWT_ISSUER: 'test',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL: '14d',
};

describe('tokenService', () => {
  it('signs and verifies an access token round trip', async () => {
    const svc = createTokenService({ config });
    const token = await svc.signAccessToken({ userId: 'u1', role: 'user' });
    const payload = await svc.verifyAccessToken(token);
    expect(payload.sub).toBe('u1');
    expect(payload.role).toBe('user');
    expect(payload.type).toBe('access');
  });

  it('rejects tokens signed by a different secret', async () => {
    const a = createTokenService({ config });
    const b = createTokenService({
      config: { ...config, JWT_SECRET: 'b'.repeat(48) },
    });
    const token = await a.signAccessToken({ userId: 'u1', role: 'user' });
    await expect(b.verifyAccessToken(token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it('reports expired tokens with ExpiredTokenError', async () => {
    const svc = createTokenService({
      config: { ...config, ACCESS_TOKEN_TTL: '1s' },
    });
    const token = await svc.signAccessToken({ userId: 'u1', role: 'user' });
    await new Promise((r) => setTimeout(r, 1100));
    await expect(svc.verifyAccessToken(token)).rejects.toBeInstanceOf(
      ExpiredTokenError,
    );
  });

  it('signs and verifies a refresh token round trip', async () => {
    const svc = createTokenService({ config });
    const token = await svc.signRefreshToken({ userId: 'u1', role: 'user' });
    const payload = await svc.verifyRefreshToken(token);
    expect(payload.sub).toBe('u1');
    expect(payload.role).toBe('user');
    expect(payload.type).toBe('refresh');
    expect(payload.jti).toBeTruthy();
  });

  it('exposes refreshTtlSeconds', () => {
    const svc = createTokenService({ config });
    expect(svc.refreshTtlSeconds).toBe(14 * 86_400);
  });
});
