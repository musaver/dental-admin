import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feePayments } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { recomputeInvoice } from '@/lib/fee';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await req.json();

    const existing = await db.query.feePayments.findFirst({ where: eq(feePayments.id, id) });
    if (!existing) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    const updateData: any = {};
    if (data.amount !== undefined) updateData.amount = parseInt(data.amount);
    if (data.type !== undefined) updateData.type = data.type === 'refund' ? 'refund' : 'payment';
    if (data.method !== undefined) updateData.method = data.method || null;
    if (data.transactionId !== undefined) updateData.transactionId = data.transactionId || null;
    if (data.transactionScreenshot !== undefined) updateData.transactionScreenshot = data.transactionScreenshot || null;
    if (data.paymentDate !== undefined) updateData.paymentDate = data.paymentDate ? new Date(data.paymentDate) : new Date();
    if (data.notes !== undefined) updateData.notes = data.notes || null;

    await db.update(feePayments).set(updateData).where(eq(feePayments.id, id));
    await recomputeInvoice(existing.invoiceId);

    const updated = await db.query.feePayments.findFirst({ where: eq(feePayments.id, id) });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update payment' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.query.feePayments.findFirst({ where: eq(feePayments.id, id) });
    if (!existing) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }
    await db.delete(feePayments).where(eq(feePayments.id, id));
    await recomputeInvoice(existing.invoiceId);
    return NextResponse.json({ message: 'Payment deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete payment' }, { status: 500 });
  }
}
