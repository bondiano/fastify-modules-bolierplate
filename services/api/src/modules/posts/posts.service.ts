import { NotFoundException } from '@kit/errors/exceptions';

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

export const createPostsService = ({
  postsRepository,
}: Pick<Dependencies, 'postsRepository'>) => {
  return {
    findById: async (id: string) => {
      const post = await postsRepository.findById(id);
      if (!post) throw new NotFoundException(`Post with id '${id}' not found`);
      return post;
    },

    findFiltered: async (options: FindFilteredInput) => {
      return postsRepository.findFiltered(options);
    },

    create: async (input: CreatePostInput) => {
      return postsRepository.create({
        title: input.title,
        content: input.content,
        status: input.status ?? 'draft',
        authorId: input.authorId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    },

    update: async (id: string, data: UpdatePostInput) => {
      const post = await postsRepository.update(id, {
        ...data,
        updatedAt: new Date().toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (!post) throw new NotFoundException(`Post with id '${id}' not found`);
      return post;
    },

    deleteById: async (id: string) => {
      const post = await postsRepository.deleteById(id);
      if (!post) throw new NotFoundException(`Post with id '${id}' not found`);
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
