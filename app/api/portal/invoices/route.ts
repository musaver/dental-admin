import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { invoices } from '@/lib/schema';
import { requirePortalContext } from '@/lib/portal-auth';
import { toErrorResponse } from '@/lib/rbac';
import { desc, inArray } from 'drizzle-orm';

/**
 * The patient's own invoices — read-only. There is no online payment gateway
 * in this phase, and the page says so rather than dangling a Pay button that
 * goes nowhere.
 */
export async function GET() {
  try {
    const ctx = await requirePortalContext();
    if (!ctx.patientIds.length) return NextResponse.json([]);

    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        issueDate: invoices.issueDate,
        totalAmount: invoices.totalAmount,
        paidAmount: invoices.paidAmount,
        status: invoices.status,
        patientId: invoices.patientId,
      })
      .from(invoices)
      .where(inArray(invoices.patientId, ctx.patientIds))
      .orderBy(desc(invoices.issueDate))
      .limit(100);

    return NextResponse.json(rows);
  } catch (error) {
    return toErrorResponse(error);
  }
}
