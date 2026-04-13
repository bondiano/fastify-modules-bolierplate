import type { Selectable } from 'kysely';

import type { DB } from '#db/schema.ts';

export interface UserResponse {
  id: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  updatedAt: string;
}

export const createUsersMapper = () => ({
  toResponse: (user: Selectable<DB['users']>): UserResponse => ({
    id: user.id,
    email: user.email,
    role: user.role as 'admin' | 'user',
    createdAt:
      user.createdAt instanceof Date
        ? user.createdAt.toISOString()
        : String(user.createdAt),
    updatedAt:
      user.updatedAt instanceof Date
        ? user.updatedAt.toISOString()
        : String(user.updatedAt),
  }),
});

export type UsersMapper = ReturnType<typeof createUsersMapper>;
