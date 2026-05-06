import { AuthError } from '../errors.js';

/** Thrown by the OAuth registry when a provider is referenced but the
 * service has no config for it (no `*_CLIENT_ID`/`*_CLIENT_SECRET` set,
 * or the provider is scaffolded-only -- Apple/Microsoft in v1). */
export class OAuthProviderNotConfigured extends AuthError {
  constructor(message: string) {
    super(message, 500, 'OAuthProviderNotConfigured');
  }
}

/** Thrown when an OAuth callback's email collides with an existing
 * local user but auto-link is refused (either side unverified). The
 * caller surfaces "sign in with your existing method to link" UX. */
export class OAuthEmailCollisionRequiresLogin extends AuthError {
  public readonly email: string;
  constructor(email: string) {
    super(
      `An account already exists for ${email}. Sign in with your existing method, then link.`,
      422,
      'OAuthEmailCollisionRequiresLogin',
    );
    this.email = email;
  }
}

/** Thrown by `DELETE /auth/oauth/:provider` when the user has no
 * password set and the targeted identity is their only login method. */
export class OAuthCannotUnlinkLastIdentity extends AuthError {
  constructor() {
    super(
      'Cannot unlink the last identity from a passwordless account.',
      422,
      'OAuthCannotUnlinkLastIdentity',
    );
  }
}

/** Thrown by `verifyOAuthState` callers when the callback's `state`
 * param is missing, expired, or signature-invalid. */
export class OAuthStateVerificationFailed extends AuthError {
  constructor(message = 'Invalid or expired OAuth state') {
    super(message, 400, 'OAuthStateVerificationFailed');
  }
}

/** Thrown when the provider returns no email AND no existing identity
 * matches the `provider_user_id` (Apple re-grant edge case). */
export class OAuthEmailMissing extends AuthError {
  public readonly provider: string;
  constructor(provider: string) {
    super(
      `${provider} returned no email and no existing identity matched. Revoke + reauthorize at the provider.`,
      422,
      'OAuthEmailMissing',
    );
    this.provider = provider;
  }
}
