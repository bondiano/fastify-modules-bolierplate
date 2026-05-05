import { describe, expect, it } from 'vitest';

import { renderOtpEmail } from './otp.js';

const event = {
  userId: 'u-1',
  email: 'a@b.com',
  purpose: 'mfa-challenge',
  code: '042815',
  expiresAt: new Date('2026-05-05T12:00:00Z'),
};

describe('renderOtpEmail', () => {
  it('renders to/subject/text/html', () => {
    const message = renderOtpEmail(event, { productName: 'Acme' });
    expect(message.to).toBe('a@b.com');
    expect(message.subject).toBe('Your verification code for Acme');
    expect(message.text).toContain('042815');
    expect(message.html).toContain('042815');
  });

  it('does not leak the code in the subject', () => {
    const message = renderOtpEmail(event);
    expect(message.subject).not.toContain('042815');
  });

  it('uses a neutral fallback when productName is missing', () => {
    const message = renderOtpEmail(event);
    expect(message.subject).toContain('your account');
  });
});
