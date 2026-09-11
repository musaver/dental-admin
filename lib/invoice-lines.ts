import {
  assertInvoiceTotals,
  computeDiscountAmount,
  computeExtraDiscountAmount,
  computeInvoiceTotals,
  computeLineAmount,
  type InvoiceLine,
} from './money.ts';
import { INVOICE_ITEM_TYPE, type DiscountType } from './enums.ts';
import { v4 as uuidv4 } from 'uuid';

/**
 * Invoice line construction — the pure half.
 *
 * Split from lib/invoices.ts (which reaches the database) the way
 * patient-identity.ts is split from patients.ts, so the arithmetic that decides
 * what a patient is charged can be unit tested without a connection.
 */

export interface DraftLine {
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  itemType: string;
  teeth?: string | null;
  procedureId?: string | null;
  visitProcedureId?: string | null;
  treatmentPlanItemId?: string | null;
}

/**
 * The patient's standing discount, as a visible line.
 *
 * Rendering it as a line rather than folding it into the header keeps the
 * printed invoice self-explanatory, and the totals rule in lib/money.ts stops
 * it double-counting. Skipped when any line already carries its own discount,
 * so the two never stack silently.
 */
export function buildPatientDiscountLine(
  lines: readonly DraftLine[],
  discountPercent: number
): DraftLine | null {
  if (!discountPercent || discountPercent <= 0) return null;
  if (lines.some((l) => l.discountAmount > 0)) return null;

  const subtotal = lines
    .filter((l) => l.itemType !== INVOICE_ITEM_TYPE.DISCOUNT)
    .reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  const amount = computeDiscountAmount(subtotal, {
    discountType: 'percentage',
    value: discountPercent,
  });
  if (amount <= 0) return null;

  return {
    description: `Patient discount (${discountPercent}%)`,
    quantity: 1,
    // A discount line is stored negative; computeInvoiceTotals expects that.
    unitPrice: -amount,
    discountAmount: 0,
    itemType: INVOICE_ITEM_TYPE.DISCOUNT,
  };
}

/**
 * The amount materialiseLines() will store for a draft.
 *
 * Extracted because buildExtraDiscountLine() needs it too: DraftLine has no
 * `amount` field, while computeInvoiceTotals() reads Math.abs(amount) for
 * discount lines. Projecting drafts into InvoiceLine without this would score
 * an existing patient-discount line as 0, and the extra percentage would then
 * be computed on a base that silently ignores it.
 */
function draftAmount(draft: DraftLine): number {
  return draft.itemType === INVOICE_ITEM_TYPE.DISCOUNT
    ? draft.quantity * draft.unitPrice // already negative
    : computeLineAmount(draft);
}

export interface ExtraDiscountInput {
  discountType: DiscountType | string;
  value: number;
  /** Printed on the line, so the patient can see what was taken off and why. */
  label: string;
}

/**
 * A staff-entered or code-driven discount, as an extra negative line.
 *
 * Unlike buildPatientDiscountLine() this never suppresses itself. That guard
 * exists because the plan and patient discounts are both IMPLICIT, and
 * applying both silently double-discounts a quote nobody re-read. An extra
 * discount is the opposite: explicit, per invoice, with a reason on the record
 * and an audit row behind it — so stacking is the entire point.
 *
 * Call it LAST. Its base is the remaining balance, not the gross subtotal, so
 * the discounts compound and the total cannot be driven below zero.
 */
export function buildExtraDiscountLine(
  lines: readonly DraftLine[],
  extra: ExtraDiscountInput
): DraftLine | null {
  const projected: InvoiceLine[] = lines.map((l) => ({
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountAmount: l.discountAmount,
    itemType: l.itemType,
    amount: draftAmount(l),
  }));

  const amount = computeExtraDiscountAmount(projected, {
    discountType: extra.discountType,
    value: extra.value,
  });
  if (amount <= 0) return null;

  return {
    description: extra.label,
    quantity: 1,
    // Negate the positive magnitude once, here. Never round a negative.
    unitPrice: -amount,
    discountAmount: 0,
    itemType: INVOICE_ITEM_TYPE.DISCOUNT,
  };
}

/** Turn draft lines into rows, computing each amount and the header totals. */
export function materialiseLines(invoiceId: string, drafts: readonly DraftLine[], now: Date) {
  const rows = drafts.map((draft) => {
    const amount = draftAmount(draft);

    return {
      id: uuidv4(),
      invoiceId,
      procedureId: draft.procedureId ?? null,
      visitProcedureId: draft.visitProcedureId ?? null,
      treatmentPlanItemId: draft.treatmentPlanItemId ?? null,
      description: draft.description.slice(0, 255),
      teeth: draft.teeth ?? null,
      quantity: draft.quantity,
      unitPrice: draft.unitPrice,
      discountAmount: draft.discountAmount,
      amount,
      itemType: draft.itemType,
      createdAt: now,
    };
  });

  const totals = computeInvoiceTotals(rows as unknown as InvoiceLine[]);
  // Refuses to write an invoice whose header disagrees with its lines.
  assertInvoiceTotals(rows as unknown as InvoiceLine[], totals);

  return { rows, totals };
}

/**
 * MySQL duplicate-key errno, which is how an invoice-number race surfaces.
 *
 * errno alone is NOT enough. uq_inv_code_patient — one redemption of a code
 * per patient — raises the same 1062 from inside this very transaction, and
 * the caller retries five times on a true result. Without the key check, a
 * patient re-using a code would burn five deterministically-failing
 * transactions and then be told the clinic could not allocate an invoice
 * number, which is simply false.
 *
 * Matched as a substring so it survives MySQL 8.0.19 qualifying key names with
 * the table ('invoices.invoices_invoiceNumber_unique').
 */
export function isDuplicateInvoiceNumber(error: unknown): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('errno' in error) ||
    (error as { errno?: number }).errno !== 1062
  ) {
    return false;
  }
  const message = String((error as { sqlMessage?: string }).sqlMessage ?? '');
  // mysql2 always populates sqlMessage for a server error. If some future
  // driver does not, fall back to the old permissive behaviour rather than
  // turning a genuine numbering race into a 500 — the redemption conflict is
  // matched by its own predicate below and checked first.
  if (!message) return true;
  return message.includes('invoiceNumber');
}

/**
 * The other 1062 this transaction can raise: uq_inv_code_patient, meaning this
 * patient has already redeemed this code. Must be checked BEFORE
 * isDuplicateInvoiceNumber, and must not be retried — it fails identically
 * every time.
 */
export function isDuplicateCodeRedemption(error: unknown): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    (error as { errno?: number }).errno !== 1062
  ) {
    return false;
  }
  return String((error as { sqlMessage?: string }).sqlMessage ?? '').includes(
    'uq_inv_code_patient'
  );
}
