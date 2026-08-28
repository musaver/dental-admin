/**
 * Money.
 *
 * Every monetary column in the schema is `int` and holds WHOLE PKR — not
 * paisa. NEVER divide by 100. Confirmed against the seeded procedures price
 * list (Consultation 1000, RCT-Molar 22000, Fixed Braces 150000) and
 * clinic_settings.currency = 'PKR'.
 *
 * Everything here is pure, so it is unit tested and safe to import anywhere.
 */

import { DISCOUNT_TYPE, INVOICE_STATUS, PAYMENT_TYPE, type DiscountType } from './enums.ts';

/**
 * 'Rs. 22,000' — whole rupees, since PKR has no practical subunit.
 *
 * en-PK groups in thousands (150,000). It is NOT the Indian lakh/crore
 * grouping; en-IN would render the same number as 1,50,000.
 */
export function formatPKR(amount: number | null | undefined): string {
  const n = Math.round(Number(amount || 0));
  return `Rs. ${n.toLocaleString('en-PK')}`;
}

/** With decimals, for an invoice or receipt where columns must line up. */
export function formatPKRPrecise(amount: number | null | undefined): string {
  const n = Number(amount || 0);
  return `Rs. ${n.toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface DiscountInput {
  discountType: DiscountType | string | null | undefined;
  value: number | null | undefined;
}

/**
 * Absolute discount for a base amount.
 *
 * treatment_plan_items stores a polymorphic pair (discountType + discountValue)
 * where the value means percent OR rupees depending on the type, while
 * invoice_items stores a flat absolute discountAmount. This is the conversion
 * between them, and the clamp is what stops a mistyped 120% producing a
 * negative line.
 */
export function computeDiscountAmount(base: number, discount: DiscountInput | null): number {
  if (!discount) return 0;
  const value = Number(discount.value || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;

  const raw =
    discount.discountType === DISCOUNT_TYPE.PERCENTAGE
      ? Math.round((base * value) / 100)
      : Math.round(value);

  return Math.max(0, Math.min(raw, Math.max(0, base)));
}

/**
 * Invoice status implied by the amounts.
 *
 * 'waived' and 'refunded' are set explicitly and are NOT derivable from
 * amounts — recomputeInvoiceStatus() below layers those on top.
 */
export function deriveInvoiceStatus(
  totalAmount: number,
  paidAmount: number
): 'unpaid' | 'partial' | 'paid' {
  if (paidAmount <= 0) return INVOICE_STATUS.UNPAID;
  if (paidAmount >= totalAmount) return INVOICE_STATUS.PAID;
  return INVOICE_STATUS.PARTIAL;
}

/**
 * Full status, including the two states amounts alone cannot express.
 *
 * - A waived invoice STAYS waived: the write-off is a decision, and a later
 *   payment must not silently undo it.
 * - An invoice whose payments have all been refunded away reads 'refunded',
 *   not 'unpaid' — otherwise it reappears in the outstanding report as though
 *   it were never settled.
 */
export function recomputeInvoiceStatus(options: {
  totalAmount: number;
  paidAmount: number;
  currentStatus?: string | null;
  hasRefunds?: boolean;
}): string {
  const { totalAmount, paidAmount, currentStatus, hasRefunds } = options;

  if (currentStatus === INVOICE_STATUS.WAIVED) return INVOICE_STATUS.WAIVED;
  if (currentStatus === INVOICE_STATUS.CANCELLED) return INVOICE_STATUS.CANCELLED;
  if (hasRefunds && paidAmount <= 0) return INVOICE_STATUS.REFUNDED;

  return deriveInvoiceStatus(totalAmount, paidAmount);
}

/**
 * Direction of a payment row.
 *
 * CONVENTION: payments.amount is ALWAYS a positive integer; direction lives in
 * payments.type. A mixed-sign column makes SUM(amount) mean different things
 * depending on which rows happen to fall in range, and invites a stray minus
 * sign to quietly reduce the day's takings.
 */
export const PAYMENT_SIGN: Record<string, 1 | -1> = {
  [PAYMENT_TYPE.PAYMENT]: 1,
  [PAYMENT_TYPE.ADVANCE]: 1,
  [PAYMENT_TYPE.ADJUSTMENT]: 1,
  [PAYMENT_TYPE.REFUND]: -1,
};

/** Signed value of a payment. Nothing should ever sum `amount` directly. */
export function signedAmount(payment: { type: string; amount: number }): number {
  const sign = PAYMENT_SIGN[payment.type] ?? 1;
  return sign * Math.abs(Number(payment.amount) || 0);
}

/** Net of a set of payments, respecting refunds. */
export function sumPayments(payments: readonly { type: string; amount: number }[]): number {
  return payments.reduce((total, p) => total + signedAmount(p), 0);
}

/** What is still owed. There is no balance column; it is always computed. */
export function invoiceBalance(invoice: { totalAmount: number; paidAmount: number }): number {
  return Number(invoice.totalAmount || 0) - Number(invoice.paidAmount || 0);
}

/* ── Invoice arithmetic ──────────────────────────────────────────────── */

export interface InvoiceLine {
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  itemType: string;
  /** Discount lines carry a negative amount; everything else is positive. */
  amount: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discountTotal: number;
  totalAmount: number;
}

/** Line total for a normal (non-discount) item. */
export function computeLineAmount(line: {
  quantity?: number | null;
  unitPrice: number;
  discountAmount?: number | null;
}): number {
  const quantity = Math.max(1, Math.round(Number(line.quantity ?? 1)));
  const gross = quantity * Math.round(Number(line.unitPrice) || 0);
  const discount = Math.max(0, Math.round(Number(line.discountAmount ?? 0)));
  return gross - Math.min(discount, gross);
}

/**
 * Roll a set of lines up into the three denormalised invoice columns.
 *
 * The rule is stated explicitly because without one, a header discount that is
 * ALSO a line item double-counts — the likeliest money bug in the module:
 *
 *   subtotal      = Σ(quantity × unitPrice) over non-discount lines, gross
 *   discountTotal = Σ(per-line discountAmount) + Σ(−amount) over discount lines
 *   totalAmount   = subtotal − discountTotal
 *
 * INVARIANT: totalAmount === Σ(amount) over every line. assertInvoiceTotals()
 * enforces it before anything is written.
 */
export function computeInvoiceTotals(lines: readonly InvoiceLine[]): InvoiceTotals {
  let subtotal = 0;
  let discountTotal = 0;

  for (const line of lines) {
    if (line.itemType === 'discount') {
      // Stored negative; it contributes its magnitude to the discount total.
      discountTotal += Math.abs(Number(line.amount) || 0);
      continue;
    }
    const quantity = Math.max(1, Math.round(Number(line.quantity ?? 1)));
    subtotal += quantity * Math.round(Number(line.unitPrice) || 0);
    discountTotal += Math.max(0, Math.round(Number(line.discountAmount ?? 0)));
  }

  return { subtotal, discountTotal, totalAmount: subtotal - discountTotal };
}

/** Throws if the totals and the lines disagree. Call before every write. */
export function assertInvoiceTotals(
  lines: readonly InvoiceLine[],
  totals: InvoiceTotals
): void {
  const sumOfLines = lines.reduce((total, l) => total + (Number(l.amount) || 0), 0);
  if (sumOfLines !== totals.totalAmount) {
    throw new Error(
      `Invoice totals do not reconcile: lines sum to ${sumOfLines} but ` +
        `totalAmount is ${totals.totalAmount} ` +
        `(subtotal ${totals.subtotal} − discount ${totals.discountTotal}).`
    );
  }
}

/**
 * Treatment plan item net.
 *
 * treatment_plan_items.netAmount is the seventh denormalised field — easy to
 * miss, since the other six are on invoices and plans.
 */
export function computeItemNet(item: {
  quantity?: number | null;
  unitPrice: number;
  discountType?: string | null;
  discountValue?: number | null;
}): number {
  const quantity = Math.max(1, Math.round(Number(item.quantity ?? 1)));
  const gross = quantity * Math.round(Number(item.unitPrice) || 0);
  const discount = computeDiscountAmount(gross, {
    discountType: item.discountType,
    value: item.discountValue,
  });
  return gross - discount;
}

/** Plan-level rollup. Invariant: netAmount === totalAmount − discountTotal. */
export function computePlanTotals(
  items: readonly {
    quantity?: number | null;
    unitPrice: number;
    discountType?: string | null;
    discountValue?: number | null;
    status?: string | null;
  }[]
): { totalAmount: number; discountTotal: number; netAmount: number } {
  let totalAmount = 0;
  let netAmount = 0;

  for (const item of items) {
    // A cancelled item is not part of what the patient is being quoted.
    if (item.status === 'cancelled') continue;
    const quantity = Math.max(1, Math.round(Number(item.quantity ?? 1)));
    totalAmount += quantity * Math.round(Number(item.unitPrice) || 0);
    netAmount += computeItemNet(item);
  }

  return { totalAmount, discountTotal: totalAmount - netAmount, netAmount };
}

/** Current period string, 'YYYY-MM'. */
export function currentPeriod(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
