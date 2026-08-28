import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { invoiceItems, invoices, patients, payments } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadInvoice } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY, INVOICE_STATUS } from '@/lib/enums';
import { recomputeInvoice } from '@/lib/derive';
import { invoiceBalance } from '@/lib/money';
import { clinicNow } from '@/lib/datetime';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(PERMISSIONS.BILLING_VIEW, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const invoice = await loadInvoice(ctx, id);

  const [items, paymentRows, [patient]] = await Promise.all([
    db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.createdAt)),
    db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(desc(payments.paymentDate)),
    db
      .select({
        id: patients.id,
        mrn: patients.mrn,
        firstName: patients.firstName,
        lastName: patients.lastName,
        phone: patients.phone,
        email: patients.email,
        address: patients.address,
      })
      .from(patients)
      .where(eq(patients.id, invoice.patientId))
      .limit(1),
  ]);

  return NextResponse.json({
    invoice,
    items,
    payments: paymentRows,
    patient: patient ?? null,
    balance: invoiceBalance({
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount ?? 0,
    }),
  });
});

const waiveSchema = z.object({ reason: z.string().trim().min(1, 'Give a reason').max(500) });

/**
 * Writing off an invoice.
 *
 * A separate permission from creating one, and it requires a reason: a
 * write-off is a financial decision someone will have to account for.
 * recomputeInvoice preserves 'waived' if money later arrives.
 */
export const PATCH = withAuth(PERMISSIONS.BILLING_WAIVE, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const before = await loadInvoice(ctx, id);

  const parsed = waiveSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Give a reason for the write-off.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  if (before.status === INVOICE_STATUS.WAIVED) {
    return NextResponse.json({ error: 'This invoice is already waived.' }, { status: 409 });
  }

  const now = clinicNow();
  await db
    .update(invoices)
    .set({
      status: INVOICE_STATUS.WAIVED,
      notes: [before.notes, `Waived: ${parsed.data.reason}`].filter(Boolean).join('\n'),
      updatedAt: now,
    })
    .where(eq(invoices.id, id));

  const after = await loadInvoice(ctx, id);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.UPDATE,
    entityType: AUDIT_ENTITY.INVOICE,
    entityId: id,
    patientId: before.patientId,
    branchId: before.branchId,
    before: { status: before.status },
    after: { status: after.status, reason: parsed.data.reason },
    request: req,
  });

  return NextResponse.json(after);
});

/** Repair path for a drifted rollup. Recomputes from the payment rows. */
export const POST = withAuth(PERMISSIONS.BILLING_CREATE, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  await loadInvoice(ctx, id);
  const result = await recomputeInvoice(id);
  return NextResponse.json(result);
});
