import type { ColumnType, Generated } from 'kysely';

import type { AuditLogTable } from '@kit/audit';
import type {
  BillingCustomersTable,
  BillingWebhookEventsTable,
  FeaturesTable,
  InvoicesTable,
  PaymentMethodsTable,
  PlanFeaturesTable,
  PlansTable,
  PricesTable,
  SubscriptionsTable,
} from '@kit/billing';
import type {
  MailDeliveriesTable,
  MailEventsTable,
  MailSuppressionsTable,
} from '@kit/mailer';
import type {
  InvitationsTable,
  MembershipsTable,
  TenantsTable as KitTenantsTable,
} from '@kit/tenancy';

/**
 * Service-side extension of `@kit/tenancy`'s `TenantsTable`. Adds the
 * per-tenant mailer override columns (P2.mailer.7 -- migration
 * `20260512000004_add_mail_from_to_tenants.ts`). Until DKIM verification
 * ships in Phase 3, `mailFrom*` is informational only -- the worker
 * still sends from `config.MAIL_FROM` and uses these as `Reply-To`.
 */
export interface TenantsTable extends KitTenantsTable {
  mailFrom: string | null;
  mailFromName: string | null;
  mailFromVerifiedAt: ColumnType<
    Date | null,
    string | null | undefined,
    string | null
  >;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  passwordHash: string;
  role: string;
  tenantId: string;
  emailVerifiedAt: ColumnType<
    Date | null,
    string | null | undefined,
    string | null
  >;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface PasswordResetTokensTable {
  id: Generated<string>;
  userId: string;
  tokenHash: string;
  expiresAt: ColumnType<Date, string, string>;
  usedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface EmailVerificationsTable {
  id: Generated<string>;
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: ColumnType<Date, string, string>;
  verifiedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface UserIdentitiesTable {
  id: Generated<string>;
  userId: string;
  provider: 'google' | 'github' | 'apple' | 'microsoft';
  providerUserId: string;
  email: string | null;
  emailVerified: Generated<boolean>;
  rawProfile: ColumnType<
    Record<string, unknown>,
    Record<string, unknown> | undefined,
    Record<string, unknown>
  >;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface OtpCodesTable {
  id: Generated<string>;
  userId: string;
  purpose: string;
  codeHash: string;
  expiresAt: ColumnType<Date, string, string>;
  usedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  attempts: Generated<number>;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

export interface PostsTable {
  id: Generated<string>;
  title: string;
  content: string;
  status: 'draft' | 'published';
  authorId: string;
  tenantId: string;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
  deletedAt: ColumnType<Date | null, string | null | undefined, string | null>;
}

export interface DB {
  users: UsersTable;
  posts: PostsTable;
  tenants: TenantsTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
  audit_log: AuditLogTable;
  password_reset_tokens: PasswordResetTokensTable;
  email_verifications: EmailVerificationsTable;
  otp_codes: OtpCodesTable;
  mail_deliveries: MailDeliveriesTable;
  mail_events: MailEventsTable;
  mail_suppressions: MailSuppressionsTable;
  billing_customers: BillingCustomersTable;
  plans: PlansTable;
  features: FeaturesTable;
  plan_features: PlanFeaturesTable;
  prices: PricesTable;
  subscriptions: SubscriptionsTable;
  invoices: InvoicesTable;
  payment_methods: PaymentMethodsTable;
  billing_webhook_events: BillingWebhookEventsTable;
  user_identities: UserIdentitiesTable;
}
