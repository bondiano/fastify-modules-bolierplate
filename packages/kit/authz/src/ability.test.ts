import { subject } from '@casl/ability';
import { describe, expect, it } from 'vitest';

import { createAbilityFactory, type DefineAbilities } from './ability.js';

const definePostAbilities: DefineAbilities = (user, builder) => {
  builder.can('read', 'Post');
  builder.can(['update', 'delete'], 'Post', { authorId: user.id });
};

describe('createAbilityFactory', () => {
  it('grants module-defined abilities to regular users', () => {
    const factory = createAbilityFactory({ definers: [definePostAbilities] });
    const ability = factory.buildFor({ id: 'u1', role: 'user' });

    expect(ability.can('read', 'Post')).toBe(true);
    expect(ability.can('create', 'Post')).toBe(false);
    expect(ability.can('update', subject('Post', { authorId: 'u1' }))).toBe(
      true,
    );
    expect(ability.can('update', subject('Post', { authorId: 'u2' }))).toBe(
      false,
    );
  });

  it('grants admins full access via the override', () => {
    const factory = createAbilityFactory({ definers: [definePostAbilities] });
    const ability = factory.buildFor({ id: 'a1', role: 'admin' });

    expect(ability.can('manage', 'Post')).toBe(true);
    expect(ability.can('delete', 'AnythingElse')).toBe(true);
  });

  it('lets the admin override be disabled', () => {
    const factory = createAbilityFactory({
      definers: [definePostAbilities],
      adminRole: null,
    });
    const ability = factory.buildFor({ id: 'a1', role: 'admin' });

    expect(ability.can('manage', 'Post')).toBe(false);
    expect(ability.can('read', 'Post')).toBe(true);
  });
});
