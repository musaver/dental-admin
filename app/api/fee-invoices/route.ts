import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeInvoices, feeInvoiceItems, user, courses, batches } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    const period = searchParams.get('period');
    const status = searchParams.get('status');

    const filters = [];
    if (batchId) filters.push(eq(feeInvoices.batchId, batchId));
    if (period) filters.push(eq(feeInvoices.period, period));
    if (status) filters.push(eq(feeInvoices.status, status));

    const rows = await db
      .select({
        invoice: feeInvoices,
        user: { id: user.id, name: user.name, email: user.email },
        course: { id: courses.id, title: courses.title },
        batch: { id: batches.id, batchName: batches.batchName },
      })
      .from(feeInvoices)
      .leftJoin(user, eq(feeInvoices.userId, user.id))
      .leftJoin(courses, eq(feeInvoices.courseId, courses.id))
      .leftJoin(batches, eq(feeInvoices.batchId, batches.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(feeInvoices.issueDate));

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

// Manual single invoice creation.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, courseId, batchId, period, baseAmount, componentsTotal, discountTotal, dueDate, notes } = body;

    if (!userId || !courseId || !period || baseAmount === undefined) {
      return NextResponse.json(
        { error: 'userId, courseId, period and baseAmount are required' },
        { status: 400 }
      );
    }

    const base = parseInt(baseAmount);
    const comp = componentsTotal ? parseInt(componentsTotal) : 0;
    const disc = discountTotal ? parseInt(discountTotal) : 0;
    const totalAmount = Math.max(0, base + comp - disc);

    const invoiceId = uuidv4();
    await db.insert(feeInvoices).values({
      id: invoiceId,
      userId,
      courseId,
      batchId: batchId || null,
      period,
      issueDate: new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      baseAmount: base,
      componentsTotal: comp,
      discountTotal: disc,
      totalAmount,
      paidAmount: 0,
      status: 'unpaid',
      notes: notes || null,
    });

    const items: any[] = [
      { id: uuidv4(), invoiceId, label: 'Tuition', itemType: 'tuition', amount: base },
    ];
    if (comp > 0) items.push({ id: uuidv4(), invoiceId, label: 'Components', itemType: 'component', amount: comp });
    if (disc > 0) items.push({ id: uuidv4(), invoiceId, label: 'Discount', itemType: 'discount', amount: -disc });
    await db.insert(feeInvoiceItems).values(items);

    return NextResponse.json({ id: invoiceId, totalAmount }, { status: 201 });
  } catch (error) {
    console.error('Error creating invoice:', error);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
