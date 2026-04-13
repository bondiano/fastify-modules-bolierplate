import { describe, expect, it, beforeEach } from 'vitest';

import { createAuthService } from './auth.service.js';
import {
  InvalidCredentialsError,
  InvalidTokenError,
  TokenRevokedError,
  UserAlreadyExistsError,
} from './errors.js';
import type { PasswordHasher } from './password.js';
import type { AuthUser, TokenBlacklistStore, UserStore } from './stores.js';
import { createTokenService } from './tokens.js';

const config = {
  JWT_SECRET: 'a'.repeat(48),
  JWT_ISSUER: 'test',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL: '14d',
};

const fakeHasher = (): PasswordHasher => ({
  hash: async (p) => `hashed:${p}`,
  verify: async (h, p) => h === `hashed:${p}`,
});

const inMemoryUserStore = (): UserStore => {
  const users = new Map<string, AuthUser>();
  return {
    findByEmail: async (email) =>
      [...users.values()].find((u) => u.email === email) ?? null,
    findById: async (id) => users.get(id) ?? null,
    create: async ({ email, passwordHash, role }) => {
      const id = `u${users.size + 1}`;
      const user: AuthUser = { id, email, passwordHash, role: role ?? 'user' };
      users.set(id, user);
      return user;
    },
  };
};

const inMemoryTokenBlacklistStore = (): TokenBlacklistStore => {
  const blacklisted = new Set<string>();
  const clearedAtMap = new Map<string, number>();
  return {
    blacklistToken: async (jti) => {
      blacklisted.add(jti);
    },
    isBlacklisted: async (jti) => blacklisted.has(jti),
    setClearedAt: async (userId, timestamp) => {
      clearedAtMap.set(userId, timestamp);
    },
    getClearedAt: async (userId) => clearedAtMap.get(userId) ?? null,
  };
};

describe('authService', () => {
  let svc: ReturnType<typeof createAuthService>;

  beforeEach(() => {
    svc = createAuthService({
      userStore: inMemoryUserStore(),
      tokenBlacklistStore: inMemoryTokenBlacklistStore(),
      passwordHasher: fakeHasher(),
      tokenService: createTokenService({ config }),
    });
  });

  it('registers a new user and issues a token pair', async () => {
    const result = await svc.register({
      email: 'a@b.com',
      password: 'password1',
    });
    expect(result.user.email).toBe('a@b.com');
    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.tokens.refreshToken).toBeTruthy();
  });

  it('rejects duplicate registrations', async () => {
    await svc.register({ email: 'a@b.com', password: 'password1' });
    await expect(
      svc.register({ email: 'a@b.com', password: 'password1' }),
    ).rejects.toBeInstanceOf(UserAlreadyExistsError);
  });

  it('logs in with valid credentials', async () => {
    await svc.register({ email: 'a@b.com', password: 'password1' });
    const result = await svc.login({ email: 'a@b.com', password: 'password1' });
    expect(result.user.email).toBe('a@b.com');
  });

  it('rejects bad credentials', async () => {
    await svc.register({ email: 'a@b.com', password: 'password1' });
    await expect(
      svc.login({ email: 'a@b.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rotates refresh tokens and revokes the old one', async () => {
    const reg = await svc.register({ email: 'a@b.com', password: 'password1' });
    const next = await svc.refresh(reg.tokens.refreshToken);
    expect(next.refreshToken).not.toBe(reg.tokens.refreshToken);
    await expect(svc.refresh(reg.tokens.refreshToken)).rejects.toBeInstanceOf(
      TokenRevokedError,
    );
  });

  it('rejects unknown refresh tokens', async () => {
    await expect(svc.refresh('nope')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('logout revokes the refresh token', async () => {
    const reg = await svc.register({ email: 'a@b.com', password: 'password1' });
    await svc.logout(reg.tokens.refreshToken);
    await expect(svc.refresh(reg.tokens.refreshToken)).rejects.toBeInstanceOf(
      TokenRevokedError,
    );
  });
});
