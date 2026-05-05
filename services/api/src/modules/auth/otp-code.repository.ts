import type { DB } from '#db/schema.ts';
import type { OtpCodeRow } from '@kit/auth';
import type { Trx } from '@kit/db/transaction';

interface OtpCodeRepositoryDeps {
  transaction: Trx<DB>;
}

interface OtpCodeRowShape {
  id: string;
  userId: string;
  purpose: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
}

const toRow = (row: OtpCodeRowShape): OtpCodeRow => ({
  id: row.id,
  userId: row.userId,
  purpose: row.purpose,
  codeHash: row.codeHash,
  expiresAt: row.expiresAt,
  usedAt: row.usedAt,
  attempts: row.attempts,
});

export const createOtpCodeRepository = ({
  transaction,
}: OtpCodeRepositoryDeps) => {
  const create = async (input: {
    userId: string;
    purpose: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<void> => {
    await transaction
      .insertInto('otp_codes')
      .values({
        userId: input.userId,
        purpose: input.purpose,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt.toISOString(),
      })
      .execute();
  };

  const findActive = async (input: {
    userId: string;
    purpose: string;
  }): Promise<OtpCodeRow | null> => {
    const row = await transaction
      .selectFrom('otp_codes')
      .selectAll()
      .where('userId', '=', input.userId)
      .where('purpose', '=', input.purpose)
      .where('usedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? toRow(row) : null;
  };

  const incrementAttempts = async (id: string): Promise<number> => {
    const updated = await transaction
      .updateTable('otp_codes')
      // Inline increment so the read+write is atomic at the DB level --
      // a concurrent verify can't observe a stale count.
      .set((eb) => ({ attempts: eb('attempts', '+', 1) }))
      .where('id', '=', id)
      .returning(['attempts'])
      .executeTakeFirstOrThrow();
    return updated.attempts;
  };

  const markUsed = async (id: string): Promise<boolean> => {
    const updated = await transaction
      .updateTable('otp_codes')
      .set({ usedAt: new Date().toISOString() })
      .where('id', '=', id)
      .where('usedAt', 'is', null)
      .returning('id')
      .execute();
    return updated.length > 0;
  };

  const pruneExpired = async (now: Date): Promise<{ deleted: number }> => {
    const rows = await transaction
      .deleteFrom('otp_codes')
      .where(transaction.dynamic.ref('expiresAt'), '<', now.toISOString())
      .returning('id')
      .execute();
    return { deleted: rows.length };
  };

  return { create, findActive, incrementAttempts, markUsed, pruneExpired };
};

export type OtpCodeRepository = ReturnType<typeof createOtpCodeRepository>;
