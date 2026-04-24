import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from '@casl/ability';

/**
 * Default action vocabulary. CASL's `manage` is a wildcard meaning "any
 * action". Modules are free to extend this set via type augmentation if they
 * need verbs beyond CRUD (e.g. `publish`, `approve`).
 */
export type AuthzAction = 'manage' | 'create' | 'read' | 'update' | 'delete';

/**
 * Subjects are either string tags (`'Post'`, `'all'`) or instance objects
 * carrying a `__typename`/class identity that CASL can match. Modules
 * augment `AuthzSubjects` to add their own subject names.
 */
export interface AuthzSubjects {
  all: 'all';
}

export type AuthzSubject = AuthzSubjects[keyof AuthzSubjects] | string | object;

export type AppAbility = MongoAbility<[AuthzAction, AuthzSubject]>;

/**
 * The minimum information an authz definer needs about the caller. The
 * actual user record stays in @kit/auth / the consuming app -- this package
 * does not own a user model.
 */
export interface AuthzUser {
  id: string;
  role: string;
}

export type AuthzAbilityBuilder = AbilityBuilder<AppAbility>;

/**
 * Per-module ability definer. Each business module exports one of these and
 * registers it with the factory at app boot.
 *
 * Definers should be additive: they grant permissions, they should not try
 * to revoke them. The admin override is applied centrally in
 * `createAbilityFactory`.
 */
export type DefineAbilities = (
  user: AuthzUser,
  builder: AuthzAbilityBuilder,
) => void;

export interface CreateAbilityFactoryOptions {
  /** Module-supplied definers, executed in order. */
  definers: readonly DefineAbilities[];
  /**
   * Role name that gets a blanket `manage all` grant before module definers
   * run. Set to `null` to disable the override entirely. Defaults to
   * `'admin'` to match the kit's default role set.
   */
  adminRole?: string | null;
}

export interface AbilityFactory {
  buildFor(user: AuthzUser): AppAbility;
}

/**
 * Build the per-request ability factory.
 *
 * Why a factory: abilities depend on the caller, but the *set of definers*
 * is fixed at boot. Wrapping the definers in a factory lets the plugin
 * resolve a single DI singleton and call `buildFor(request.auth)` per
 * request without re-discovering modules.
 */
export const createAbilityFactory = ({
  definers,
  adminRole = 'admin',
}: CreateAbilityFactoryOptions): AbilityFactory => ({
  buildFor(user) {
    const builder = new AbilityBuilder<AppAbility>(createMongoAbility);

    if (adminRole !== null && user.role === adminRole) {
      builder.can('manage', 'all');
    } else {
      for (const define of definers) define(user, builder);
    }

    return builder.build();
  },
});

/**
 * Helper for tests / one-offs that need an empty ability without going
 * through the factory.
 */
export const createEmptyAbility = (): AppAbility =>
  new AbilityBuilder<AppAbility>(createMongoAbility).build();

/**
 * Re-export CASL's `subject()` helper so consumers don't have to depend on
 * `@casl/ability` directly. Tag an instance object with a subject name so
 * the default detector can match it against rules defined on that tag:
 *
 * ```ts
 * preHandler: [
 *   fastify.authorize('update', 'Post', async (request) => {
 *     const post = await postsService.findById(request.params.id);
 *     return subject('Post', post);
 *   }),
 * ],
 * ```
 */
export { subject } from '@casl/ability';
