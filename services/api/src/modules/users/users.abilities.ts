import type { DefineAbilities } from '@kit/authz';

export const defineUserAbilities: DefineAbilities = (user, builder) => {
  builder.can('read', 'User', { id: user.id });
  builder.can('update', 'User', { id: user.id });
};
