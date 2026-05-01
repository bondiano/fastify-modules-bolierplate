import type { ColumnType, Generated } from 'kysely';

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
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
  updatedAt: ColumnType<Date, string | undefined, string | undefined>;
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
}
