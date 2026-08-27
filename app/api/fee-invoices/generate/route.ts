import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  feeInvoices,
  feeInvoiceItems,
  feeStructures,
  feeComponents,
  feeDiscounts,
  orders,
  batches,
  courses,
} from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { computeDiscountAmount } from '@/lib/money';

// POST { batchId, period: 'YYYY-MM' }
// Creates one invoice per enrolled (completed-order) student for the period,
// snapshotting base tuition + components - applicable discounts. Idempotent.
export async function POST(request: Request) {
  try {
    const { batchId, period } = await request.json();

    if (!batchId || !period || !/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json(
        { error: 'batchId and period (YYYY-MM) are required' },
        { status: 400 }
      );
    }

    const batch = await db.query.batches.findFirst({ where: eq(batches.id, batchId) });
    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }
    const courseId = batch.courseId;

    const course = await db.query.courses.findFirst({ where: eq(courses.id, courseId) });

    // Active fee structure for the course (first one wins); fall back to course price.
    const structures = await db
      .select()
      .from(feeStructures)
      .where(and(eq(feeStructures.courseId, courseId), eq(feeStructures.isActive, true)));
    const structure = structures[0];
    const baseAmount = structure ? structure.baseAmount : course?.price ?? 0;
    const dueDayOfMonth = structure?.dueDayOfMonth ?? null;

    // Components for the structure.
    const components = structure
      ? await db
          .select()
          .from(feeComponents)
          .where(and(eq(feeComponents.feeStructureId, structure.id), eq(feeComponents.isActive, true)))
      : [];
    const recurringComponents = components.filter((c) => c.frequency === 'recurring');
    const oneTimeComponents = components.filter((c) => c.frequency === 'one_time');

    // Enrolled students: distinct users with a completed order for this batch.
    const enrolledOrders = await db
      .select({ userId: orders.userId, orderId: orders.id })
      .from(orders)
      .where(and(eq(orders.batchId, batchId), eq(orders.status, 'completed')));

    const seenUser = new Set<string>();
    const enrolled = enrolledOrders.filter((o) => {
      if (seenUser.has(o.userId)) return false;
      seenUser.add(o.userId);
      return true;
    });

    // Active discounts that could apply (course/batch scope, or any student scope).
    const allDiscounts = await db
      .select()
      .from(feeDiscounts)
      .where(eq(feeDiscounts.isActive, true));

    const now = new Date();
    const withinValidity = (d: any) => {
      if (d.validFrom && new Date(d.validFrom) > now) return false;
      if (d.validTo && new Date(d.validTo) < now) return false;
      return true;
    };

    // Due date for the period.
    const [year, month] = period.split('-').map((x: string) => parseInt(x));
    const dueDate = dueDayOfMonth ? new Date(year, month - 1, dueDayOfMonth) : null;

    let created = 0;
    let skipped = 0;

    for (const enrollment of enrolled) {
      const userId = enrollment.userId;

      // Idempotency: skip if an invoice already exists for this student+batch+period.
      const existing = await db
        .select({ id: feeInvoices.id })
        .from(feeInvoices)
        .where(
          and(
            eq(feeInvoices.userId, userId),
            eq(feeInvoices.batchId, batchId),
            eq(feeInvoices.period, period)
          )
        )
        .limit(1);
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // Is this the student's first invoice for the batch? (controls one-time components)
      const prior = await db
        .select({ id: feeInvoices.id })
        .from(feeInvoices)
        .where(and(eq(feeInvoices.userId, userId), eq(feeInvoices.batchId, batchId)))
        .limit(1);
      const isFirstInvoice = prior.length === 0;

      const applicableComponents = isFirstInvoice
        ? [...recurringComponents, ...oneTimeComponents]
        : recurringComponents;
      const componentsTotal = applicableComponents.reduce((sum, c) => sum + c.amount, 0);

      // Applicable discounts for this student.
      const applicableDiscounts = allDiscounts.filter((d) => {
        if (!withinValidity(d)) return false;
        if (d.scope === 'course') return d.courseId === courseId;
        if (d.scope === 'batch') return d.batchId === batchId;
        if (d.scope === 'student') return d.userId === userId;
        return false;
      });

      // Discounts apply to the base tuition. Sum, then clamp to the charge total.
      let discountTotal = 0;
      const discountItems: { label: string; amount: number }[] = [];
      for (const d of applicableDiscounts) {
        const amt = computeDiscountAmount(baseAmount, d);
        if (amt > 0) {
          discountTotal += amt;
          discountItems.push({ label: d.name, amount: amt });
        }
      }
      discountTotal = Math.min(discountTotal, baseAmount + componentsTotal);

      const totalAmount = Math.max(0, baseAmount + componentsTotal - discountTotal);

      const invoiceId = uuidv4();
      await db.insert(feeInvoices).values({
        id: invoiceId,
        userId,
        courseId,
        batchId,
        orderId: enrollment.orderId,
        period,
        issueDate: now,
        dueDate,
        baseAmount,
        componentsTotal,
        discountTotal,
        totalAmount,
        paidAmount: 0,
        status: 'unpaid',
      });

      // Itemized snapshot.
      const items: any[] = [
        { id: uuidv4(), invoiceId, label: structure?.name || 'Tuition', itemType: 'tuition', amount: baseAmount },
        ...applicableComponents.map((c) => ({
          id: uuidv4(),
          invoiceId,
          label: c.name,
          itemType: 'component',
          amount: c.amount,
        })),
        ...discountItems.map((d) => ({
          id: uuidv4(),
          invoiceId,
          label: d.label,
          itemType: 'discount',
          amount: -d.amount,
        })),
      ];
      await db.insert(feeInvoiceItems).values(items);

      created++;
    }

    return NextResponse.json({ created, skipped, enrolled: enrolled.length });
  } catch (error) {
    console.error('Error generating invoices:', error);
    return NextResponse.json({ error: 'Failed to generate invoices' }, { status: 500 });
  }
}
