/**
 * Consumer-side mail template registry for billing flows. Imported once
 * from `bin/server.ts` so the side-effect `defineTemplate(...)` calls
 * run before any `mailerService.send('invoice-receipt', ...)` reaches
 * the registry.
 *
 * The kit's own `templates/seed.ts` ships the 5 auth/tenancy templates;
 * this file ships the 4 billing-specific templates per the convention
 * that consumer-shipped templates live in the consumer service.
 */
import { defineTemplate } from '@kit/mailer';

export interface SubscriptionWelcomePayload {
  readonly planName: string;
  readonly customerName: string;
  readonly dashboardUrl: string;
  readonly productName: string;
}

export interface SubscriptionTrialEndingPayload {
  readonly planName: string;
  readonly customerName: string;
  readonly trialEndsAt: string;
  readonly manageUrl: string;
  readonly productName: string;
}

export interface InvoiceReceiptPayload {
  readonly invoiceNumber: string;
  readonly amount: string;
  readonly customerName: string;
  readonly hostedUrl: string;
  readonly pdfUrl: string;
  readonly productName: string;
}

export interface InvoicePaymentFailedPayload {
  readonly invoiceNumber: string;
  readonly amount: string;
  readonly customerName: string;
  readonly retryUrl: string;
  readonly productName: string;
}

declare global {
  interface MailTemplates {
    'subscription-welcome': SubscriptionWelcomePayload;
    'subscription-trial-ending': SubscriptionTrialEndingPayload;
    'invoice-receipt': InvoiceReceiptPayload;
    'invoice-payment-failed': InvoicePaymentFailedPayload;
  }
}

defineTemplate('subscription-welcome', {
  subject: 'Welcome to {{planName}} on {{productName}}',
  tags: ['transactional', 'billing'],
  previewFixture: {
    to: 'preview@example.com',
    payload: {
      planName: 'Pro',
      customerName: 'Alex',
      dashboardUrl: 'https://app.example.com/dashboard',
      productName: 'Acme',
    },
  },
});

defineTemplate('subscription-trial-ending', {
  subject: 'Your {{productName}} trial ends {{trialEndsAt}}',
  tags: ['transactional', 'billing'],
  previewFixture: {
    to: 'preview@example.com',
    payload: {
      planName: 'Pro',
      customerName: 'Alex',
      trialEndsAt: 'Tue, 19 May 2026 12:00:00 GMT',
      manageUrl: 'https://app.example.com/billing/portal',
      productName: 'Acme',
    },
  },
});

defineTemplate('invoice-receipt', {
  subject: 'Receipt {{invoiceNumber}} for {{productName}}',
  tags: ['transactional', 'billing'],
  previewFixture: {
    to: 'preview@example.com',
    payload: {
      invoiceNumber: 'INV-1024',
      amount: '$49.00',
      customerName: 'Alex',
      hostedUrl: 'https://invoice.example.com/in_1024',
      pdfUrl: 'https://invoice.example.com/in_1024.pdf',
      productName: 'Acme',
    },
  },
});

defineTemplate('invoice-payment-failed', {
  subject: 'Payment failed for {{productName}} ({{invoiceNumber}})',
  tags: ['transactional', 'billing'],
  previewFixture: {
    to: 'preview@example.com',
    payload: {
      invoiceNumber: 'INV-1025',
      amount: '$49.00',
      customerName: 'Alex',
      retryUrl: 'https://app.example.com/billing/portal',
      productName: 'Acme',
    },
  },
});
