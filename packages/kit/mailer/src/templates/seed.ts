/**
 * Registers the 5 seed templates with the typed `MailTemplates` registry.
 * Importing this file once at module-load time (e.g. via the kit's
 * barrel) populates the registry so `mailerService.send('password-reset',
 * payload, opts)` is type-checked end-to-end.
 *
 * Each entry pairs a registered MailTemplates payload type, a subject
 * line (Handlebars-interpolated), and a synthetic preview fixture used
 * by `/admin/mail/preview` -- the fixture must NEVER reference real
 * customer data (the preview route's TypeBox validator rejects
 * payloads outside this shape).
 */
import { defineTemplate } from './registry.js';

// Per-template payload shapes. Extracted to named interfaces so the
// `kit-custom/no-complex-inline-type` lint rule is satisfied (the
// invitation payload has six fields, well above the 4-property
// inline-literal threshold).
export interface WelcomeUserPayload {
  readonly name: string;
  readonly productName: string;
  readonly dashboardUrl: string;
}

export interface VerifyEmailPayload {
  readonly email: string;
  readonly verifyUrl: string;
  readonly expiresAt: string;
  readonly productName: string;
}

export interface PasswordResetPayload {
  readonly resetUrl: string;
  readonly expiresAt: string;
  readonly productName: string;
}

export interface TenantInvitationPayload {
  readonly tenantName: string;
  readonly inviter: string;
  readonly role: string;
  readonly acceptUrl: string;
  readonly expiresAt: string;
  readonly productName: string;
}

export interface OtpCodePayload {
  readonly code: string;
  readonly expiresAt: string;
  readonly productName: string;
}

// `MailTemplates` is a global interface declared in `registry.ts`. Each
// `interface MailTemplates { ... }` block here merges into it (TS
// declaration merging). Ordering matters only across compilation units;
// inside this file the augmentation is in effect immediately so the
// `defineTemplate(...)` calls below type-check.
declare global {
  interface MailTemplates {
    'welcome-user': WelcomeUserPayload;
    'verify-email': VerifyEmailPayload;
    'password-reset': PasswordResetPayload;
    'tenant-invitation': TenantInvitationPayload;
    'otp-code': OtpCodePayload;
  }
}

defineTemplate('welcome-user', {
  subject: 'Welcome to {{productName}}, {{name}}',
  tags: ['transactional', 'onboarding'],
  previewFixture: {
    to: 'preview@example.com',
    payload: {
      name: 'Alex',
      productName: 'Acme',
      dashboardUrl: 'https://app.example.com/dashboard',
    },
  },
});

defineTemplate('verify-email', {
  subject: 'Confirm your email for {{productName}}',
  tags: ['transactional', 'auth'],
  previewFixture: {
    to: 'preview@example.com',
    payload: {
      email: 'preview@example.com',
      verifyUrl:
        'https://app.example.com/auth/email-verification/confirm?token=preview',
      expiresAt: 'Tue, 06 May 2026 12:00:00 GMT',
      productName: 'Acme',
    },
  },
});

defineTemplate('password-reset', {
  subject: 'Reset your password for {{productName}}',
  tags: ['transactional', 'auth'],
  previewFixture: {
    to: 'preview@example.com',
    payload: {
      resetUrl:
        'https://app.example.com/auth/password-reset/confirm?token=preview',
      expiresAt: 'Tue, 06 May 2026 12:00:00 GMT',
      productName: 'Acme',
    },
  },
});

defineTemplate('tenant-invitation', {
  subject: "You're invited to join {{tenantName}}",
  tags: ['transactional', 'tenancy'],
  previewFixture: {
    to: 'preview@example.com',
    payload: {
      tenantName: 'Acme Workspace',
      inviter: 'Sam Admin',
      role: 'member',
      acceptUrl: 'https://app.example.com/auth/invite?token=preview',
      expiresAt: 'Tue, 06 May 2026 12:00:00 GMT',
      productName: 'Acme',
    },
  },
});

defineTemplate('otp-code', {
  subject: 'Your verification code for {{productName}}',
  tags: ['transactional', 'auth', 'mfa'],
  previewFixture: {
    to: 'preview@example.com',
    payload: {
      code: '042815',
      expiresAt: 'Tue, 06 May 2026 12:00:00 GMT',
      productName: 'Acme',
    },
  },
});
