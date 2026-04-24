import { defineDomainError } from '@kit/errors/domain';
import { NotFoundException } from '@kit/errors/exceptions';

export class UserNotFound extends defineDomainError(
  'UserNotFound',
  NotFoundException,
) {
  readonly userId: string;

  constructor(userId: string) {
    super(`User ${userId} not found`);
    this.userId = userId;
  }
}
