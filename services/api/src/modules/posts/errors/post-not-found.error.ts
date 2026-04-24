import { defineDomainError } from '@kit/errors/domain';
import { NotFoundException } from '@kit/errors/exceptions';

export class PostNotFound extends defineDomainError(
  'PostNotFound',
  NotFoundException,
) {
  readonly postId: string;

  constructor(postId: string) {
    super(`Post ${postId} not found`);
    this.postId = postId;
  }
}
