/**
 * Invoice numbering — pure, so it is unit tested.
 *
 * Format: INV-MAIN-2608-00042
 *         prefix, branch code, YYMM, then a zero-padded sequence.
 *
 * The zero padding is load-bearing, exactly as it is for MRNs: because every
 * sequence is the same width, ORDER BY invoiceNumber DESC is numeric order, so
 * finding the next number is a bounded range scan on the existing
 * invoices_invoiceNumber_unique index rather than a scan of the table.
 *
 * Width: 3 + 1 + 10 + 1 + 4 + 1 + 5 = 25 at worst, inside varchar(30), with
 * branches.code capped at varchar(10).
 */

export const INVOICE_PREFIX = 'INV';
export const INVOICE_SEQUENCE_WIDTH = 5;

/** 'YYMM' for the month an invoice is issued in. */
export function invoicePeriod(date: Date): string {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}${mm}`;
}

export function formatInvoiceNumber(
  branchCode: string,
  period: string,
  sequence: number
): string {
  return [
    INVOICE_PREFIX,
    branchCode.toUpperCase(),
    period,
    String(sequence).padStart(INVOICE_SEQUENCE_WIDTH, '0'),
  ].join('-');
}

/** The LIKE pattern that selects one branch-month, for finding the last number. */
export function invoiceNumberPrefix(branchCode: string, period: string): string {
  return `${INVOICE_PREFIX}-${branchCode.toUpperCase()}-${period}-`;
}

/** Sequence part of an invoice number, or 0 if it does not parse. */
export function parseInvoiceSequence(invoiceNumber: string): number {
  const match = /-(\d+)$/.exec(invoiceNumber);
  return match ? Number(match[1]) : 0;
}

export class InvoiceNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceNumberError';
  }
}

/**
 * The next number after `previous`, which may be undefined for the first
 * invoice of a branch-month.
 *
 * Sequences reset monthly and are per branch, so two clinics never collide and
 * the number says when and where it was raised.
 */
export function nextInvoiceNumber(
  branchCode: string,
  issuedAt: Date,
  previous?: string | null
): string {
  const period = invoicePeriod(issuedAt);
  const next = previous ? parseInvoiceSequence(previous) + 1 : 1;

  if (next >= 10 ** INVOICE_SEQUENCE_WIDTH) {
    throw new InvoiceNumberError(
      `Branch ${branchCode} has issued ${next - 1} invoices in ${period}, exhausting the ` +
        `${INVOICE_SEQUENCE_WIDTH}-digit range.`
    );
  }

  return formatInvoiceNumber(branchCode, period, next);
}
