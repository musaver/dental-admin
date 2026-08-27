import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feePayments, feeInvoices } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc } from 'drizzle-orm';
import { recomputeInvoice } from '@/lib/fee';

export async function GET(request: NextRequest) {
  try {
    const invoiceId = new URL(request.url).searchParams.get('invoiceId');
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 });
    }
    const payments = await db
      .select()
      .from(feePayments)
      .where(eq(feePayments.invoiceId, invoiceId))
      .orderBy(desc(feePayments.paymentDate));
    return NextResponse.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 });
  }
}

// Record a payment or refund against an invoice, then recompute the invoice.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { invoiceId, amount, type, method, transactionId, transactionScreenshot, paymentDate, notes, recordedBy } = body;

    if (!invoiceId || amount === undefined || Number(amount) <= 0) {
      return NextResponse.json({ error: 'invoiceId and a positive amount are required' }, { status: 400 });
    }

    const invoice = await db.query.feeInvoices.findFirst({ where: eq(feeInvoices.id, invoiceId) });
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const newPayment = {
      id: uuidv4(),
      invoiceId,
      userId: invoice.userId,
      amount: parseInt(amount),
      type: type === 'refund' ? 'refund' : 'payment',
      method: method || null,
      transactionId: transactionId || null,
      transactionScreenshot: transactionScreenshot || null,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      notes: notes || null,
      recordedBy: recordedBy || null,
    };

    await db.insert(feePayments).values(newPayment);
    await recomputeInvoice(invoiceId);

    return NextResponse.json(newPayment, { status: 201 });
  } catch (error) {
    console.error('Error recording payment:', error);
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 });
  }
}
