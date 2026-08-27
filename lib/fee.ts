import { db } from './db';
import { feeInvoices, feePayments } from './schema';
import { eq, and, sum } from 'drizzle-orm';
import { deriveInvoiceStatus } from './money';

// Recompute an invoice's paidAmount + status from its payments.
// paidAmount = SUM(payments) - SUM(refunds). 'waived' status is preserved.
export async function recomputeInvoice(invoiceId: string): Promise<void> {
  const invoice = await db.query.feeInvoices.findFirst({ where: eq(feeInvoices.id, invoiceId) });
  if (!invoice) return;

  const paidRows = await db
    .select({ total: sum(feePayments.amount) })
    .from(feePayments)
    .where(and(eq(feePayments.invoiceId, invoiceId), eq(feePayments.type, 'payment')));

  const refundRows = await db
    .select({ total: sum(feePayments.amount) })
    .from(feePayments)
    .where(and(eq(feePayments.invoiceId, invoiceId), eq(feePayments.type, 'refund')));

  const paid = Number(paidRows[0]?.total || 0);
  const refunded = Number(refundRows[0]?.total || 0);
  const paidAmount = paid - refunded;

  const status =
    invoice.status === 'waived'
      ? 'waived'
      : deriveInvoiceStatus(invoice.totalAmount, paidAmount);

  await db
    .update(feeInvoices)
    .set({ paidAmount, status })
    .where(eq(feeInvoices.id, invoiceId));
}
