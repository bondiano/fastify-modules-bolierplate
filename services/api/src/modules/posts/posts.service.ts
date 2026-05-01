import { PostNotFound } from './errors/post-not-found.error.ts';
import type { PostsRepository } from './posts.repository.ts';

interface PostsServiceDeps {
  postsRepository: PostsRepository;
}

interface CreatePostInput {
  title: string;
  content: string;
  status?: 'draft' | 'published';
  authorId: string;
}

interface UpdatePostInput {
  title?: string;
  content?: string;
  status?: 'draft' | 'published';
}

export interface FindFilteredInput {
  search?: string;
  status?: string;
  authorId?: string;
  page?: number;
  limit?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
}

export const createPostsService = ({ postsRepository }: PostsServiceDeps) => {
  return {
    findById: async (id: string) => {
      const post = await postsRepository.findById(id);
      if (!post) throw new PostNotFound(id);
      return post;
    },

    findFiltered: async (options: FindFilteredInput) => {
      return postsRepository.findFiltered(options);
    },

    create: async (input: CreatePostInput) => {
      // `tenantId` is auto-stamped by the scoped repository from the
      // active tenant frame; `as never` matches the kit's pattern for
      // sidestepping `Insertable<DB['posts']>`'s required `tenantId`.
      return postsRepository.create({
        title: input.title,
        content: input.content,
        status: input.status ?? 'draft',
        authorId: input.authorId,
      } as never);
    },

    update: async (id: string, data: UpdatePostInput) => {
      const post = await postsRepository.update(id, {
        ...data,
        updatedAt: new Date().toISOString(),
      });
      if (!post) throw new PostNotFound(id);
      return post;
    },

    deleteById: async (id: string) => {
      const post = await postsRepository.deleteById(id);
      if (!post) throw new PostNotFound(id);
      return post;
    },

    bulkDelete: async (ids: string[]) => {
      return postsRepository.bulkDelete(ids);
    },

    bulkUpdate: async (ids: string[], data: UpdatePostInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return postsRepository.bulkUpdate(ids, data as any);
    },
  };
};

export type PostsService = ReturnType<typeof createPostsService>;
