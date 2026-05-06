/**
 * GitHub OAuth provider. GitHub's `/user` endpoint returns the
 * profile but the email there can be a placeholder when the user has
 * `Keep my email addresses private` enabled. We hit `/user/emails`
 * separately and pick the primary AND verified email -- the only safe
 * source for the email-collision auto-link gate.
 *
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
 */
import type {
  BuildAuthorizeUrlInput,
  ExchangeCodeInput,
  ExchangeCodeResult,
  OAuthProfile,
  OAuthProvider,
} from '../types.js';
import { appendQueryParams } from '../url.js';

export interface GitHubProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
}

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const EMAILS_URL = 'https://api.github.com/user/emails';
const SCOPES = 'read:user user:email';

interface GitHubEmail {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

export const createGitHubProvider = (
  options: GitHubProviderOptions,
): OAuthProvider => ({
  name: 'github',

  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
    return appendQueryParams(AUTHORIZE_URL, {
      client_id: options.clientId,
      scope: SCOPES,
      redirect_uri: input.redirectUri,
      state: input.state,
      // GitHub doesn't formally require PKCE yet, but RFC 9700 says
      // include it -- GitHub accepts and ignores when not enforced.
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    });
  },

  async exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
    const body = new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    });
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `GitHub token exchange failed: ${response.status} ${text}`,
      );
    }
    const json = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!json.access_token) {
      throw new Error(
        `GitHub token exchange returned no access_token: ${json.error_description ?? 'unknown'}`,
      );
    }
    return { accessToken: json.access_token };
  },

  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fastify-saas-kit',
    };
    const userResponse = await fetch(USER_URL, { headers });
    if (!userResponse.ok) {
      throw new Error(`GitHub user fetch failed: ${userResponse.status}`);
    }
    const user = (await userResponse.json()) as Record<string, unknown>;
    const id = user.id;
    if (typeof id !== 'number' && typeof id !== 'string') {
      throw new TypeError('GitHub user response missing numeric `id`');
    }

    const emailsResponse = await fetch(EMAILS_URL, { headers });
    let primaryVerified: GitHubEmail | undefined;
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as readonly GitHubEmail[];
      primaryVerified = emails.find((entry) => entry.primary && entry.verified);
    }

    const fallbackEmail =
      typeof user.email === 'string' &&
      !user.email.endsWith('@users.noreply.github.com')
        ? user.email
        : null;
    const email = primaryVerified?.email ?? fallbackEmail;
    const emailVerified = primaryVerified?.verified === true;

    return {
      providerUserId: String(id),
      email,
      emailVerified,
      displayName: typeof user.name === 'string' ? user.name : null,
      raw: user,
    };
  },
});
