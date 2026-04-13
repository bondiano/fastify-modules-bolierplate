import type { DefineAbilities } from '@kit/authz';

export const definePostAbilities: DefineAbilities = (user, builder) => {
  builder.can('read', 'Post');
  builder.can(['create', 'update', 'delete'], 'Post', { authorId: user.id });
};
