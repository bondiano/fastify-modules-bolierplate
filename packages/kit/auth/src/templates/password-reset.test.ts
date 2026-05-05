import { describe, expect, it } from 'vitest';

import { renderPasswordResetEmail } from './password-reset.js';

const baseEvent = {
  userId: 'u-1',
  email: 'a@b.com',
  token: 'raw-token',
  expiresAt: new Date('2026-05-05T12:00:00Z'),
};

describe('renderPasswordResetEmail', () => {
  it('renders to/subject/text/html', () => {
    const message = renderPasswordResetEmail(baseEvent, {
      resetUrl: 'https://app.example.com/auth/password-reset',
      productName: 'Acme',
    });
    expect(message.to).toBe('a@b.com');
    expect(message.subject).toBe('Reset your password for Acme');
    expect(message.text).toContain(
      'https://app.example.com/auth/password-reset?token=raw-token',
    );
    expect(message.html).toContain('Reset password');
  });

  it('appends `&token=` when the URL already carries query params', () => {
    const message = renderPasswordResetEmail(baseEvent, {
      resetUrl: 'https://app.example.com/auth/password-reset?lang=en',
    });
    expect(message.text).toContain(
      'https://app.example.com/auth/password-reset?lang=en&token=raw-token',
    );
  });

  it('uses neutral fallback for missing productName', () => {
    const message = renderPasswordResetEmail(baseEvent, {
      resetUrl: 'https://x/r',
    });
    expect(message.subject).toContain('your account');
  });

  it('html-escapes user-controlled fields', () => {
    const message = renderPasswordResetEmail(
      { ...baseEvent, email: '"a@b.com"' },
      {
        resetUrl: 'https://x/r',
        productName: '<Acme>',
      },
    );
    expect(message.html).toContain('&lt;Acme&gt;');
    expect(message.html).not.toContain('<Acme>');
  });
});
