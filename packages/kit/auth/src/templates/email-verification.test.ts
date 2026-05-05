import { describe, expect, it } from 'vitest';

import { renderEmailVerificationEmail } from './email-verification.js';

const event = {
  userId: 'u-1',
  email: 'a@b.com',
  token: 'raw-token',
  expiresAt: new Date('2026-05-05T12:00:00Z'),
};

describe('renderEmailVerificationEmail', () => {
  it('renders to/subject/text/html', () => {
    const message = renderEmailVerificationEmail(event, {
      verifyUrl: 'https://x/v',
      productName: 'Acme',
    });
    expect(message.to).toBe('a@b.com');
    expect(message.subject).toBe('Confirm your email for Acme');
    expect(message.text).toContain('https://x/v?token=raw-token');
  });

  it('escapes the email in the html body', () => {
    const message = renderEmailVerificationEmail(
      { ...event, email: '<x@y.com>' },
      { verifyUrl: 'https://x/v' },
    );
    expect(message.html).toContain('&lt;x@y.com&gt;');
  });
});
