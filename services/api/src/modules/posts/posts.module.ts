import type { PostsMapper } from './posts.mapper.ts';
import type { PostsRepository } from './posts.repository.ts';
import type { PostsService } from './posts.service.ts';

declare global {
  interface Dependencies {
    postsRepository: PostsRepository;
    postsService: PostsService;
    postsMapper: PostsMapper;
  }
}
