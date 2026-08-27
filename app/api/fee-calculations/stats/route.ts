import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeInvoices, feePayments } from '@/lib/schema';
import { sum, count, and, gte, lte, ne, eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const buildDateFilter = (dateField: any) => {
      const filters = [];
      if (startDate) filters.push(gte(dateField, new Date(startDate)));
      if (endDate) {
        const endPlusOne = new Date(endDate);
        endPlusOne.setDate(endPlusOne.getDate() + 1);
        filters.push(lte(dateField, endPlusOne));
      }
      return filters;
    };

    const invoiceDateFilters = buildDateFilter(feeInvoices.issueDate);
    const invoiceWhere = invoiceDateFilters.length ? and(...invoiceDateFilters) : undefined;

    // Billed + collected over all invoices in range.
    const billedAgg = await db
      .select({ billed: sum(feeInvoices.totalAmount), collected: sum(feeInvoices.paidAmount) })
      .from(feeInvoices)
      .where(invoiceWhere);

    // Outstanding excludes waived invoices.
    const nonWaivedFilters = [...invoiceDateFilters, ne(feeInvoices.status, 'waived')];
    const outstandingAgg = await db
      .select({ total: sum(feeInvoices.totalAmount), paid: sum(feeInvoices.paidAmount) })
      .from(feeInvoices)
      .where(and(...nonWaivedFilters));

    // Refunds over payments in range (by payment date).
    const refundFilters = [...buildDateFilter(feePayments.paymentDate), eq(feePayments.type, 'refund')];
    const refundAgg = await db
      .select({ refunded: sum(feePayments.amount) })
      .from(feePayments)
      .where(and(...refundFilters));

    // Counts by status.
    const statusRows = await db
      .select({ status: feeInvoices.status, c: count() })
      .from(feeInvoices)
      .where(invoiceWhere)
      .groupBy(feeInvoices.status);

    const billed = Number(billedAgg[0]?.billed || 0);
    const collected = Number(billedAgg[0]?.collected || 0);
    const outstanding = Number(outstandingAgg[0]?.total || 0) - Number(outstandingAgg[0]?.paid || 0);
    const refunded = Number(refundAgg[0]?.refunded || 0);

    const statusCounts: Record<string, number> = {};
    for (const row of statusRows) statusCounts[row.status] = Number(row.c);

    return NextResponse.json({
      totalBilled: billed,
      totalCollected: collected,
      totalOutstanding: Math.max(0, outstanding),
      totalRefunded: refunded,
      statusCounts,
      dateRange: { startDate, endDate },
    });
  } catch (error) {
    console.error('Error fetching fee stats:', error);
    return NextResponse.json({ error: 'Failed to fetch fee statistics' }, { status: 500 });
  }
}
