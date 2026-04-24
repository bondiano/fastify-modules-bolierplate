import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotFoundException } from '@kit/errors/exceptions';

import { UserNotFound } from '../errors/user-not-found.error.ts';
import type { UsersRepository } from '../users.repository.ts';
import { createUsersService } from '../users.service.ts';

type User = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
};

const sampleUser: User = {
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: 'hash',
  role: 'user',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const createFakeRepository = () => {
  const repo = {
    findById: vi.fn(),
    findPaginatedByPage: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
  };
  return repo as unknown as UsersRepository & typeof repo;
};

describe('createUsersService', () => {
  let usersRepository: ReturnType<typeof createFakeRepository>;
  let service: ReturnType<typeof createUsersService>;

  beforeEach(() => {
    usersRepository = createFakeRepository();
    service = createUsersService({ usersRepository });
  });

  describe('findById', () => {
    it('returns the user when found', async () => {
      usersRepository.findById.mockResolvedValue(sampleUser);
      await expect(service.findById('user-1')).resolves.toEqual(sampleUser);
    });

    it('throws UserNotFound when the repo returns null', async () => {
      usersRepository.findById.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toBeInstanceOf(
        UserNotFound,
      );
    });

    it('the thrown UserNotFound maps to a NotFoundException', async () => {
      usersRepository.findById.mockResolvedValue(null);
      const err = await service.findById('missing').catch((error) => error);
      expect(err).toBeInstanceOf(UserNotFound);
      expect(err._tag).toBe('UserNotFound');
      expect(err.userId).toBe('missing');
      expect(err.toException()).toBeInstanceOf(NotFoundException);
    });
  });

  describe('findPaginated', () => {
    it('delegates to findPaginatedByPage with page + limit only', async () => {
      const page = { items: [sampleUser], total: 1 };
      usersRepository.findPaginatedByPage.mockResolvedValue(page);

      await expect(
        service.findPaginated({ page: 2, limit: 10 }),
      ).resolves.toEqual(page);

      expect(usersRepository.findPaginatedByPage).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
      });
    });

    it('forwards orderBy and order when provided', async () => {
      usersRepository.findPaginatedByPage.mockResolvedValue({
        items: [],
        total: 0,
      });

      await service.findPaginated({
        page: 1,
        limit: 20,
        orderBy: 'createdAt',
        order: 'asc',
      });

      expect(usersRepository.findPaginatedByPage).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        orderByField: 'createdAt',
        orderByDirection: 'asc',
      });
    });
  });

  describe('update', () => {
    it('stamps updatedAt and returns the updated user', async () => {
      usersRepository.update.mockResolvedValue({
        ...sampleUser,
        role: 'admin',
      });

      const result = await service.update('user-1', { role: 'admin' });

      expect(result.role).toBe('admin');
      expect(usersRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          role: 'admin',
          updatedAt: expect.any(String),
        }),
      );
    });

    it('throws UserNotFound when the repo returns null', async () => {
      usersRepository.update.mockResolvedValue(null);
      await expect(
        service.update('missing', { role: 'admin' }),
      ).rejects.toBeInstanceOf(UserNotFound);
    });
  });

  describe('deleteById', () => {
    it('returns the deleted user', async () => {
      usersRepository.deleteById.mockResolvedValue(sampleUser);
      await expect(service.deleteById('user-1')).resolves.toEqual(sampleUser);
    });

    it('throws UserNotFound when the repo returns null', async () => {
      usersRepository.deleteById.mockResolvedValue(null);
      await expect(service.deleteById('missing')).rejects.toBeInstanceOf(
        UserNotFound,
      );
    });
  });
});
