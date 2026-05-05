import type { DB } from '#db/schema.ts';
import type { EmailVerificationTokenRow } from '@kit/auth';
import type { Trx } from '@kit/db/transaction';

interface EmailVerificationTokenRepositoryDeps {
  transaction: Trx<DB>;
}

interface EmailVerificationTokenRowShape {
  id: string;
  userId: string;
  email: string;
  expiresAt: Date;
  verifiedAt: Date | null;
}

const toRow = (
  row: EmailVerificationTokenRowShape,
): EmailVerificationTokenRow => ({
  id: row.id,
  userId: row.userId,
  email: row.email,
  expiresAt: row.expiresAt,
  verifiedAt: row.verifiedAt,
});

export const createEmailVerificationTokenRepository = ({
  transaction,
}: EmailVerificationTokenRepositoryDeps) => {
  const create = async (input: {
    userId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> => {
    await transaction
      .insertInto('email_verifications')
      .values({
        userId: input.userId,
        email: input.email,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt.toISOString(),
      })
      .execute();
  };

  const findByTokenHash = async (
    tokenHash: string,
  ): Promise<EmailVerificationTokenRow | null> => {
    const row = await transaction
      .selectFrom('email_verifications')
      .selectAll()
      .where('tokenHash', '=', tokenHash)
      .executeTakeFirst();
    return row ? toRow(row) : null;
  };

  const markVerified = async (id: string): Promise<boolean> => {
    const updated = await transaction
      .updateTable('email_verifications')
      .set({ verifiedAt: new Date().toISOString() })
      .where('id', '=', id)
      .where('verifiedAt', 'is', null)
      .returning('id')
      .execute();
    return updated.length > 0;
  };

  const pruneExpired = async (now: Date): Promise<{ deleted: number }> => {
    const rows = await transaction
      .deleteFrom('email_verifications')
      .where(transaction.dynamic.ref('expiresAt'), '<', now.toISOString())
      .returning('id')
      .execute();
    return { deleted: rows.length };
  };

  return { create, findByTokenHash, markVerified, pruneExpired };
};

export type EmailVerificationTokenRepository = ReturnType<
  typeof createEmailVerificationTokenRepository
>;
