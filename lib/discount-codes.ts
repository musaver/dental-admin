import { db } from '@/lib/db';
import { discountCodes } from '@/lib/schema';
import { discountCodeLabel, normalizeDiscountCode } from '@/lib/discount-code-rules';
import { type DiscountType } from '@/lib/enums';
import { clinicNow } from '@/lib/datetime';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

/**
 * Redeemable discount codes — the database half.
 *
 * The rules themselves live in lib/discount-code-rules.ts, which is pure and
 * therefore unit tested; this file is only the queries. Same split as
 * patient-identity.ts / patients.ts.
 *
 * There is no redemptions table. Invoices are never hard-deleted, so
 * `invoices WHERE discountCodeId = ?` IS the redemption ledger, and the
 * uq_inv_code_patient unique index makes once-per-patient a database guarantee
 * rather than a racy SELECT.
 */

export * from '@/lib/discount-code-rules';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DiscountCodeRow = typeof discountCodes.$inferSelect;

/** Look a code up by its canonical form. Null when there is no such code. */
export async function findDiscountCode(
  tx: Executor,
  rawCode: string
): Promise<DiscountCodeRow | null> {
  const [row] = await tx
    .select()
    .from(discountCodes)
    .where(eq(discountCodes.code, normalizeDiscountCode(rawCode)))
    .limit(1);
  // tsconfig has no noUncheckedIndexedAccess, so `row` is typed as present even
  // when the result set is empty. The ?? is doing real work.
  return row ?? null;
}

/**
 * Consume one redemption. THE authority on the usage limit.
 *
 * A conditional UPDATE, not SELECT-then-UPDATE. Under MySQL's default
 * REPEATABLE READ a plain SELECT is a non-locking snapshot read: two
 * transactions both see usedCount 4 against a limit of 5, both conclude one is
 * left, and both increment — 4 → 5 → 6. Folding the guard into the statement
 * that takes the row lock makes the second transaction block, re-evaluate
 * against the first's committed row, and match nothing.
 *
 * MUST be the last statement in the invoice transaction. POST /api/invoices
 * retries the whole transaction up to five times on an invoice-number
 * collision, and it is the ROLLBACK of a failed attempt that stops one invoice
 * burning five redemptions — so this can never run outside the tx callback.
 * Going last also keeps the row's exclusive lock to microseconds instead of
 * holding it across allocateInvoiceNumber()'s LIKE scan and two full
 * invoice_items dedupe scans, on a five-connection pool.
 *
 * Returns false when the limit is already spent; the caller must then abort the
 * transaction, which is what makes the increment and the invoice atomic.
 */
export async function redeemDiscountCode(tx: Executor, codeId: string): Promise<boolean> {
  const result = await tx
    .update(discountCodes)
    .set({
      usedCount: sql`${discountCodes.usedCount} + 1`,
      updatedAt: clinicNow(),
    })
    .where(
      and(
        eq(discountCodes.id, codeId),
        eq(discountCodes.isActive, true),
        or(
          isNull(discountCodes.maxRedemptions),
          lt(discountCodes.usedCount, discountCodes.maxRedemptions)
        )
      )
    );

  // mysql2 returns [ResultSetHeader, ...]; same cast as app/api/cron/daily.
  // affectedRows is unambiguous here regardless of CLIENT_FOUND_ROWS, because
  // the row always changes when the WHERE matches.
  return (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows === 1;
}

/** Resolve a code into the extra-discount shape createInvoice() expects. */
export function toExtraDiscount(code: DiscountCodeRow): {
  discountType: DiscountType | string;
  value: number;
  label: string;
} {
  return {
    discountType: code.discountType,
    value: code.discountValue,
    label: discountCodeLabel(code),
  };
}
