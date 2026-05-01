import { subject } from '@casl/ability';
import { describe, expect, it } from 'vitest';

import { createAbilityFactory, type DefineAbilities } from './ability.js';

const definePostAbilities: DefineAbilities = (user, builder) => {
  builder.can('read', 'Post');
  builder.can(['update', 'delete'], 'Post', { authorId: user.id });
};

const defineTenantInviteAbilities: DefineAbilities = (
  _user,
  builder,
  membership,
) => {
  // Only tenant owners and admins can invite. Single-tenant routes (no
  // membership) silently no-op.
  if (!membership) return;
  if (membership.role === 'owner' || membership.role === 'admin') {
    builder.can('create', 'Invitation');
  }
};

const defineTenantAbilities: DefineAbilities = (_user, builder, membership) => {
  if (!membership) return;
  if (membership.role === 'owner') {
    builder.can('manage', 'Tenant', { id: membership.tenantId });
  } else if (membership.role === 'admin') {
    builder.can(['read', 'update'], 'Tenant', { id: membership.tenantId });
  } else {
    builder.can('read', 'Tenant', { id: membership.tenantId });
  }
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

  it('passes membership to definers when provided', () => {
    const factory = createAbilityFactory({
      definers: [defineTenantInviteAbilities],
    });
    const ability = factory.buildFor(
      { id: 'u1', role: 'user' },
      { tenantId: 'acme', role: 'owner' },
    );
    expect(ability.can('create', 'Invitation')).toBe(true);
  });

  it('definers see undefined membership for single-tenant calls', () => {
    const factory = createAbilityFactory({
      definers: [defineTenantInviteAbilities],
    });
    const ability = factory.buildFor({ id: 'u1', role: 'user' });
    expect(ability.can('create', 'Invitation')).toBe(false);
  });

  it('tenant-level role rules can deny lower-privileged members', () => {
    const factory = createAbilityFactory({
      definers: [defineTenantInviteAbilities],
    });
    const ability = factory.buildFor(
      { id: 'u1', role: 'user' },
      { tenantId: 'acme', role: 'member' },
    );
    expect(ability.can('create', 'Invitation')).toBe(false);
  });

  describe("'Tenant' subject gated by membership role (PRD §2a authz check)", () => {
    // The kit's spec calls out `ability.can('manage', 'Tenant', { id })`
    // as the canonical check that membership roles must gate. Pin it so
    // the wiring can't silently regress.
    it('lets an owner manage their tenant', () => {
      const factory = createAbilityFactory({
        definers: [defineTenantAbilities],
      });
      const ability = factory.buildFor(
        { id: 'u1', role: 'user' },
        { tenantId: 't-1', role: 'owner' },
      );
      expect(ability.can('manage', subject('Tenant', { id: 't-1' }))).toBe(
        true,
      );
      expect(ability.can('delete', subject('Tenant', { id: 't-1' }))).toBe(
        true,
      );
    });

    it('denies a member from managing the tenant', () => {
      const factory = createAbilityFactory({
        definers: [defineTenantAbilities],
      });
      const ability = factory.buildFor(
        { id: 'u1', role: 'user' },
        { tenantId: 't-1', role: 'member' },
      );
      expect(ability.can('read', subject('Tenant', { id: 't-1' }))).toBe(true);
      expect(ability.can('manage', subject('Tenant', { id: 't-1' }))).toBe(
        false,
      );
      expect(ability.can('update', subject('Tenant', { id: 't-1' }))).toBe(
        false,
      );
      expect(ability.can('delete', subject('Tenant', { id: 't-1' }))).toBe(
        false,
      );
    });

    it("does not leak permissions to a sibling tenant's row", () => {
      const factory = createAbilityFactory({
        definers: [defineTenantAbilities],
      });
      const ability = factory.buildFor(
        { id: 'u1', role: 'user' },
        { tenantId: 't-1', role: 'owner' },
      );
      // Owner of t-1 must not be able to manage t-2.
      expect(ability.can('manage', subject('Tenant', { id: 't-2' }))).toBe(
        false,
      );
    });
  });
});
