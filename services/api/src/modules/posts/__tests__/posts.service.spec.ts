import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotFoundException } from '@kit/errors/exceptions';

import { PostNotFound } from '../errors/post-not-found.error.ts';
import type { PostsRepository } from '../posts.repository.ts';
import { createPostsService } from '../posts.service.ts';

type Post = {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'published';
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

const samplePost: Post = {
  id: 'post-1',
  title: 'Hello',
  content: 'world',
  status: 'draft',
  authorId: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
};

const createFakeRepository = () => {
  const repo = {
    findById: vi.fn(),
    findFiltered: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
    bulkDelete: vi.fn(),
    bulkUpdate: vi.fn(),
  };
  return repo as unknown as PostsRepository & typeof repo;
};

describe('createPostsService', () => {
  let postsRepository: ReturnType<typeof createFakeRepository>;
  let service: ReturnType<typeof createPostsService>;

  beforeEach(() => {
    postsRepository = createFakeRepository();
    service = createPostsService({ postsRepository });
  });

  describe('findById', () => {
    it('returns the post when found', async () => {
      postsRepository.findById.mockResolvedValue(samplePost);
      await expect(service.findById('post-1')).resolves.toEqual(samplePost);
      expect(postsRepository.findById).toHaveBeenCalledWith('post-1');
    });

    it('throws PostNotFound when the repo returns null', async () => {
      postsRepository.findById.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toBeInstanceOf(
        PostNotFound,
      );
    });

    it('the thrown PostNotFound maps to a NotFoundException', async () => {
      postsRepository.findById.mockResolvedValue(null);
      const err = await service.findById('missing').catch((error) => error);
      expect(err).toBeInstanceOf(PostNotFound);
      expect(err._tag).toBe('PostNotFound');
      expect(err.postId).toBe('missing');
      expect(err.toException()).toBeInstanceOf(NotFoundException);
    });
  });

  describe('findFiltered', () => {
    it('delegates to the repository', async () => {
      const page = { items: [samplePost], total: 1 };
      postsRepository.findFiltered.mockResolvedValue(page);
      await expect(
        service.findFiltered({ page: 1, limit: 20 }),
      ).resolves.toEqual(page);
      expect(postsRepository.findFiltered).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
      });
    });
  });

  describe('create', () => {
    it('defaults status to draft', async () => {
      postsRepository.create.mockResolvedValue(samplePost);
      await service.create({
        title: 'T',
        content: 'C',
        authorId: 'user-1',
      });
      expect(postsRepository.create).toHaveBeenCalledWith({
        title: 'T',
        content: 'C',
        status: 'draft',
        authorId: 'user-1',
      });
    });

    it('forwards an explicit status', async () => {
      postsRepository.create.mockResolvedValue(samplePost);
      await service.create({
        title: 'T',
        content: 'C',
        status: 'published',
        authorId: 'user-1',
      });
      expect(postsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'published' }),
      );
    });
  });

  describe('update', () => {
    it('stamps updatedAt and returns the updated post', async () => {
      postsRepository.update.mockResolvedValue({
        ...samplePost,
        title: 'Renamed',
      });

      const result = await service.update('post-1', { title: 'Renamed' });

      expect(result.title).toBe('Renamed');
      expect(postsRepository.update).toHaveBeenCalledWith(
        'post-1',
        expect.objectContaining({
          title: 'Renamed',
          updatedAt: expect.any(String),
        }),
      );
    });

    it('throws PostNotFound when the repo returns null', async () => {
      postsRepository.update.mockResolvedValue(null);
      await expect(
        service.update('missing', { title: 'x' }),
      ).rejects.toBeInstanceOf(PostNotFound);
    });
  });

  describe('deleteById', () => {
    it('returns the deleted post', async () => {
      postsRepository.deleteById.mockResolvedValue(samplePost);
      await expect(service.deleteById('post-1')).resolves.toEqual(samplePost);
    });

    it('throws PostNotFound when the repo returns null', async () => {
      postsRepository.deleteById.mockResolvedValue(null);
      await expect(service.deleteById('missing')).rejects.toBeInstanceOf(
        PostNotFound,
      );
    });
  });

  describe('bulk operations', () => {
    it('bulkDelete delegates to the repository', async () => {
      postsRepository.bulkDelete.mockResolvedValue({ count: 2 });
      await service.bulkDelete(['a', 'b']);
      expect(postsRepository.bulkDelete).toHaveBeenCalledWith(['a', 'b']);
    });

    it('bulkUpdate delegates to the repository', async () => {
      postsRepository.bulkUpdate.mockResolvedValue({ count: 2 });
      await service.bulkUpdate(['a', 'b'], { status: 'published' });
      expect(postsRepository.bulkUpdate).toHaveBeenCalledWith(['a', 'b'], {
        status: 'published',
      });
    });
  });
});
