import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeInvoices, feeInvoiceItems, feePayments, user, courses, batches } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const rows = await db
      .select({
        invoice: feeInvoices,
        user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
        course: { id: courses.id, title: courses.title },
        batch: { id: batches.id, batchName: batches.batchName },
      })
      .from(feeInvoices)
      .leftJoin(user, eq(feeInvoices.userId, user.id))
      .leftJoin(courses, eq(feeInvoices.courseId, courses.id))
      .leftJoin(batches, eq(feeInvoices.batchId, batches.id))
      .where(eq(feeInvoices.id, id))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const items = await db.select().from(feeInvoiceItems).where(eq(feeInvoiceItems.invoiceId, id));
    const payments = await db
      .select()
      .from(feePayments)
      .where(eq(feePayments.invoiceId, id))
      .orderBy(desc(feePayments.paymentDate));

    return NextResponse.json({ ...rows[0], items, payments });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get invoice' }, { status: 500 });
  }
}

// Update status (e.g. waive) and/or notes.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await req.json();

    const updateData: any = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;

    await db.update(feeInvoices).set(updateData).where(eq(feeInvoices.id, id));
    const updated = await db.query.feeInvoices.findFirst({ where: eq(feeInvoices.id, id) });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(feePayments).where(eq(feePayments.invoiceId, id));
    await db.delete(feeInvoiceItems).where(eq(feeInvoiceItems.invoiceId, id));
    await db.delete(feeInvoices).where(eq(feeInvoices.id, id));
    return NextResponse.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
