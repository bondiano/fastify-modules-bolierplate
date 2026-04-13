import type { UsersMapper } from './users.mapper.ts';
import type { UsersRepository } from './users.repository.ts';
import type { UsersService } from './users.service.ts';

declare global {
  interface Dependencies {
    usersRepository: UsersRepository;
    usersService: UsersService;
    usersMapper: UsersMapper;
  }
}
