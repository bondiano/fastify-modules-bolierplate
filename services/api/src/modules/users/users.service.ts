import { UserNotFound } from './errors/user-not-found.error.ts';
import type { UsersRepository } from './users.repository.ts';

interface UsersServiceDeps {
  usersRepository: UsersRepository;
}

export const createUsersService = ({ usersRepository }: UsersServiceDeps) => {
  return {
    findById: async (id: string) => {
      const user = await usersRepository.findById(id);
      if (!user) throw new UserNotFound(id);
      return user;
    },

    findPaginated: async (options: {
      page: number;
      limit: number;
      orderBy?: string;
      order?: 'asc' | 'desc';
    }) => {
      return usersRepository.findPaginatedByPage({
        page: options.page,
        limit: options.limit,
        ...(options.orderBy ? { orderByField: options.orderBy } : {}),
        ...(options.order ? { orderByDirection: options.order } : {}),
      });
    },

    update: async (id: string, data: { email?: string; role?: string }) => {
      const user = await usersRepository.update(id, {
        ...data,
        updatedAt: new Date().toISOString(),
      });
      if (!user) throw new UserNotFound(id);
      return user;
    },

    deleteById: async (id: string) => {
      const user = await usersRepository.deleteById(id);
      if (!user) throw new UserNotFound(id);
      return user;
    },
  };
};

export type UsersService = ReturnType<typeof createUsersService>;
