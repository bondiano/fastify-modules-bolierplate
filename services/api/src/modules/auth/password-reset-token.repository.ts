import type { DB } from '#db/schema.ts';
import type { PasswordResetTokenRow } from '@kit/auth';
import type { Trx } from '@kit/db/transaction';

interface PasswordResetTokenRepositoryDeps {
  transaction: Trx<DB>;
}

interface PasswordResetTokenRowShape {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

const toRow = (row: PasswordResetTokenRowShape): PasswordResetTokenRow => ({
  id: row.id,
  userId: row.userId,
  expiresAt: row.expiresAt,
  usedAt: row.usedAt,
});

export const createPasswordResetTokenRepository = ({
  transaction,
}: PasswordResetTokenRepositoryDeps) => {
  /** System-level: auth runs before any tenant frame is active. */
  const create = async (input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> => {
    await transaction
      .insertInto('password_reset_tokens')
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt.toISOString(),
      })
      .execute();
  };

  const findByTokenHash = async (
    tokenHash: string,
  ): Promise<PasswordResetTokenRow | null> => {
    const row = await transaction
      .selectFrom('password_reset_tokens')
      .selectAll()
      .where('tokenHash', '=', tokenHash)
      .executeTakeFirst();
    return row ? toRow(row) : null;
  };

  /** Atomic single-use guard: returns false when the row was already used. */
  const markUsed = async (id: string): Promise<boolean> => {
    const updated = await transaction
      .updateTable('password_reset_tokens')
      .set({ usedAt: new Date().toISOString() })
      .where('id', '=', id)
      .where('usedAt', 'is', null)
      .returning('id')
      .execute();
    return updated.length > 0;
  };

  const pruneExpired = async (now: Date): Promise<{ deleted: number }> => {
    const rows = await transaction
      .deleteFrom('password_reset_tokens')
      .where(transaction.dynamic.ref('expiresAt'), '<', now.toISOString())
      .returning('id')
      .execute();
    return { deleted: rows.length };
  };

  return { create, findByTokenHash, markUsed, pruneExpired };
};

export type PasswordResetTokenRepository = ReturnType<
  typeof createPasswordResetTokenRepository
>;
