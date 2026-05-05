import type { ColumnType, Generated } from 'kysely';

import type { AuditLogTable } from '@kit/audit';
import type {
  InvitationsTable,
  MembershipsTable,
  TenantsTable,
} from '@kit/tenancy';

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
}
