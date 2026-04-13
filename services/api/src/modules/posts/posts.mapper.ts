import type { Selectable } from 'kysely';

import type { DB } from '#db/schema.ts';

export interface PostResponse {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'published';
  authorId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const createPostsMapper = () => ({
  toResponse: (post: Selectable<DB['posts']>): PostResponse => ({
    id: post.id,
    title: post.title,
    content: post.content,
    status: post.status,
    authorId: post.authorId,
    createdAt:
      post.createdAt instanceof Date
        ? post.createdAt.toISOString()
        : String(post.createdAt),
    updatedAt:
      post.updatedAt instanceof Date
        ? post.updatedAt.toISOString()
        : String(post.updatedAt),
    deletedAt:
      post.deletedAt instanceof Date
        ? post.deletedAt.toISOString()
        : post.deletedAt
          ? String(post.deletedAt)
          : null,
  }),
});

export type PostsMapper = ReturnType<typeof createPostsMapper>;
