import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

const escapeHtml = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const buildAcceptUrl = (request: FastifyRequest, token: string): string => {
  // Reconstruct the public base URL from the request -- avoids forcing
  // a `PUBLIC_URL` config var on the boilerplate. Production deployments
  // behind a proxy should set `trustProxy` so `request.protocol` /
  // `request.hostname` reflect the original.
  const base = `${request.protocol}://${request.hostname}`;
  return `${base}/auth/invite?token=${encodeURIComponent(token)}`;
};

/**
 * Admin-side action endpoints surfaced via `defineAdminResource(...).detailActions`.
 *
 * Currently:
 *  - `POST /admin/invitations/:id/regenerate` -- mints a new token,
 *    extends `expires_at`, fires the invitation event, and renders an
 *    HTML fragment showing the accept URL so the admin can copy it
 *    manually until the mailer is wired (`P2.mailer.*`).
 *  - `POST /admin/users/:id/force-password-reset` -- looks up the
 *    target user's email and calls `authService.requestPasswordReset`.
 *    The mailer-stub event handler logs the message; once
 *    `P2.mailer.*` lands the user receives a real reset link.
 *  - `POST /admin/users/:id/resend-verification` -- mints a fresh
 *    verification token and fires the corresponding event.
 *
 * Auth + tenant resolution come from the parent `@kit/tenancy`
 * (resolves the active tenant from the cookie) and `@kit/auth`
 * (`verifyAdmin` requires `role === 'admin'`). CSRF is not enforced
 * here because the kit's admin-form CSRF service is scoped inside
 * `@kit/admin`'s plugin context; future work can lift the helper out
 * for shared use. The `confirm` prompt on the button gates accidental
 * clicks for now.
 *
 * Every action emits a `request.audit('admin.<action>', ...)` so ops
 * can correlate admin-driven security events.
 */
const adminActionsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/admin/invitations/:id/regenerate',
    {
      onRequest: [fastify.verifyAdmin],
    },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as { id: string };
      const { membershipsService } = fastify.diContainer.cradle;

      const { token, invitation } = await membershipsService.regenerate(id);
      const acceptUrl = buildAcceptUrl(request, token);

      const expires = invitation.expiresAt.toISOString().slice(0, 19) + 'Z';
      const html = `<section class="admin-flash admin-flash--success" role="status">
  <h2>Invitation regenerated</h2>
  <p>New accept URL (valid until <code>${escapeHtml(expires)}</code>):</p>
  <p><code class="admin-copyable">${escapeHtml(acceptUrl)}</code></p>
  <p class="muted">Copy this link before navigating away -- the raw token is shown only here.</p>
</section>`;

      reply.type('text/html; charset=utf-8');
      return html;
    },
  );

  fastify.post(
    '/admin/users/:id/force-password-reset',
    { onRequest: [fastify.verifyAdmin] },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as { id: string };
      const { userStore, authService } = fastify.diContainer.cradle;

      const user = await userStore.findById(id);
      if (!user) {
        reply.type('text/html; charset=utf-8').status(404);
        return `<section class="admin-flash admin-flash--error" role="alert">
  <h2>User not found</h2>
  <p>No user with id <code>${escapeHtml(id)}</code>.</p>
</section>`;
      }

      await authService.requestPasswordReset(user.email);
      request.audit(
        'admin.force-password-reset',
        { type: 'User', id: user.id },
        undefined,
        { email: user.email },
      );

      reply.type('text/html; charset=utf-8');
      return `<section class="admin-flash admin-flash--success" role="status">
  <h2>Password reset link sent</h2>
  <p>A fresh password-reset email has been queued for <code>${escapeHtml(user.email)}</code>.</p>
</section>`;
    },
  );

  fastify.post(
    '/admin/users/:id/resend-verification',
    { onRequest: [fastify.verifyAdmin] },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as { id: string };
      const { userStore, authService } = fastify.diContainer.cradle;

      const user = await userStore.findById(id);
      if (!user) {
        reply.type('text/html; charset=utf-8').status(404);
        return `<section class="admin-flash admin-flash--error" role="alert">
  <h2>User not found</h2>
  <p>No user with id <code>${escapeHtml(id)}</code>.</p>
</section>`;
      }

      await authService.requestEmailVerification(user.id);
      request.audit(
        'admin.resend-verification',
        { type: 'User', id: user.id },
        undefined,
        { email: user.email },
      );

      reply.type('text/html; charset=utf-8');
      return `<section class="admin-flash admin-flash--success" role="status">
  <h2>Verification email sent</h2>
  <p>A fresh verification email has been queued for <code>${escapeHtml(user.email)}</code>.</p>
</section>`;
    },
  );
};

export const createAdminActionsPlugin = fp(adminActionsPlugin, {
  name: 'admin-actions',
  dependencies: ['@kit/auth', '@kit/admin'],
});

export default createAdminActionsPlugin;
