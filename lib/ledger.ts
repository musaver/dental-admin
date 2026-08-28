import { db } from '@/lib/db';
import { invoices, payments } from '@/lib/schema';
import { INVOICE_STATUS, PAYMENT_TYPE } from '@/lib/enums';
import { signedAmount } from '@/lib/money';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

/**
 * The patient account.
 *
 * A UNION of invoices and payments, NOT a walk over invoices.
 *
 * payments.invoiceId is nullable, so a deposit or an advance belongs to no
 * invoice at all. Walking invoices alone would silently omit every one of
 * them, and the balance shown to the patient would be wrong by exactly the
 * money they had already handed over.
 */

export type LedgerKind = 'invoice' | 'payment' | 'refund' | 'advance' | 'adjustment' | 'waiver';

export interface LedgerEntry {
  id: string;
  date: Date;
  kind: LedgerKind;
  reference: string;
  description: string;
  /** Increases what the patient owes. */
  debit: number;
  /** Reduces what the patient owes. */
  credit: number;
  balance: number;
  invoiceId?: string | null;
  allocatedTo?: string | null;
  method?: string | null;
}

export interface LedgerSummary {
  totalBilled: number;
  totalPaid: number;
  totalRefunded: number;
  totalWaived: number;
  /** Outstanding across invoices, before credit is applied. */
  outstanding: number;
  /** Money on account, not yet attached to an invoice. */
  unallocatedCredit: number;
  /** What the patient actually owes once credit is taken into account. */
  netBalance: number;
  /** False when the stored invoice rollups disagree with the payment rows. */
  reconciles: boolean;
}

export interface Ledger {
  entries: LedgerEntry[];
  summary: LedgerSummary;
}

/**
 * Ordering rank within a single timestamp.
 *
 * An invoice must sort before a payment made at the same moment, or the
 * running balance dips negative for one row and the statement looks wrong.
 */
const KIND_RANK: Record<LedgerKind, number> = {
  invoice: 0,
  waiver: 1,
  payment: 2,
  advance: 2,
  adjustment: 2,
  refund: 3,
};

export async function getPatientLedger(
  patientId: string,
  options: { from?: Date; to?: Date } = {}
): Promise<Ledger> {
  const [invoiceRows, paymentRows] = await Promise.all([
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        issueDate: invoices.issueDate,
        totalAmount: invoices.totalAmount,
        paidAmount: invoices.paidAmount,
        status: invoices.status,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.patientId, patientId),
          options.from ? gte(invoices.issueDate, options.from) : undefined,
          options.to ? lte(invoices.issueDate, options.to) : undefined
        )
      ),
    db
      .select({
        id: payments.id,
        invoiceId: payments.invoiceId,
        amount: payments.amount,
        type: payments.type,
        method: payments.method,
        paymentDate: payments.paymentDate,
        transactionId: payments.transactionId,
        notes: payments.notes,
      })
      .from(payments)
      .where(
        and(
          eq(payments.patientId, patientId),
          options.from ? gte(payments.paymentDate, options.from) : undefined,
          options.to ? lte(payments.paymentDate, options.to) : undefined
        )
      ),
  ]);

  const invoiceNumberById = new Map(invoiceRows.map((i) => [i.id, i.invoiceNumber]));

  const raw: Omit<LedgerEntry, 'balance'>[] = [];

  let totalBilled = 0;
  let totalWaived = 0;

  for (const invoice of invoiceRows) {
    const date = invoice.issueDate ?? new Date(0);
    totalBilled += invoice.totalAmount;

    raw.push({
      id: invoice.id,
      date,
      kind: 'invoice',
      reference: invoice.invoiceNumber,
      description: 'Invoice',
      debit: invoice.totalAmount,
      credit: 0,
      invoiceId: invoice.id,
    });

    // A waived invoice needs an explicit offsetting entry, or the running
    // balance shows the patient still owing money that was written off — and
    // the write-off itself becomes invisible.
    if (invoice.status === INVOICE_STATUS.WAIVED) {
      totalWaived += invoice.totalAmount;
      raw.push({
        id: `${invoice.id}-waiver`,
        date,
        kind: 'waiver',
        reference: invoice.invoiceNumber,
        description: 'Waived',
        debit: 0,
        credit: invoice.totalAmount,
        invoiceId: invoice.id,
      });
    }
  }

  let totalPaid = 0;
  let totalRefunded = 0;
  let unallocatedCredit = 0;

  for (const payment of paymentRows) {
    const signed = signedAmount(payment);
    const isRefund = payment.type === PAYMENT_TYPE.REFUND;

    if (isRefund) totalRefunded += payment.amount;
    else totalPaid += payment.amount;

    if (payment.invoiceId === null) unallocatedCredit += signed;

    raw.push({
      id: payment.id,
      date: payment.paymentDate ?? new Date(0),
      kind: payment.type as LedgerKind,
      reference: payment.transactionId ?? '',
      description:
        payment.notes ??
        (isRefund ? 'Refund' : payment.invoiceId ? 'Payment' : 'Payment on account'),
      // A refund gives money back, so it increases what is owed again.
      debit: isRefund ? payment.amount : 0,
      credit: isRefund ? 0 : payment.amount,
      invoiceId: payment.invoiceId,
      allocatedTo: payment.invoiceId
        ? (invoiceNumberById.get(payment.invoiceId) ?? 'Another invoice')
        : 'On account',
      method: payment.method,
    });
  }

  raw.sort((a, b) => {
    const byDate = a.date.getTime() - b.date.getTime();
    if (byDate !== 0) return byDate;
    return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  });

  let running = 0;
  const entries: LedgerEntry[] = raw.map((entry) => {
    running += entry.debit - entry.credit;
    return { ...entry, balance: running };
  });

  const outstanding = invoiceRows.reduce(
    // paidAmount defaults to 0 but is nullable in the schema.
    (sum, i) => sum + (i.totalAmount - (i.paidAmount ?? 0)),
    0
  );
  const netBalance = outstanding - unallocatedCredit;

  /*
   * Self-check.
   *
   * invoices.paidAmount is denormalised with no trigger or foreign key
   * protecting it. If the closing running balance disagrees with
   * outstanding − credit, that rollup has drifted from the payment rows and
   * the figures on this page cannot be trusted. Surfacing it is far cheaper
   * than discovering it in a month-end reconciliation.
   */
  const reconciles = entries.length === 0 || running === netBalance;

  return {
    entries,
    summary: {
      totalBilled,
      totalPaid,
      totalRefunded,
      totalWaived,
      outstanding,
      unallocatedCredit,
      netBalance,
      reconciles,
    },
  };
}

/** Credit on account: payments belonging to no invoice. */
export async function getUnallocatedCredit(patientId: string): Promise<number> {
  const rows = await db
    .select({ type: payments.type, amount: payments.amount })
    .from(payments)
    .where(and(eq(payments.patientId, patientId), isNull(payments.invoiceId)));

  return rows.reduce((sum, p) => sum + signedAmount(p), 0);
}
