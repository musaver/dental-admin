import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { invoices, payments } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadInvoice, loadPatient } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  PAYMENT_METHOD,
  PAYMENT_TYPE,
  valuesOf,
} from '@/lib/enums';
import { recomputeInvoice } from '@/lib/derive';
import { invoiceBalance } from '@/lib/money';
import { clinicNow } from '@/lib/datetime';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const schema = z.object({
  patientId: z.string().min(1).max(255),
  /** Null means money on account, not yet against any invoice. */
  invoiceId: z.string().max(255).nullable().optional(),
  // Always POSITIVE. Direction lives in `type` — see lib/money.ts PAYMENT_SIGN.
  amount: z.coerce.number().int().min(1, 'Enter an amount'),
  type: z.enum(valuesOf(PAYMENT_TYPE) as [string, ...string[]]).default(PAYMENT_TYPE.PAYMENT),
  method: z.enum(valuesOf(PAYMENT_METHOD) as [string, ...string[]]).nullable().optional(),
  transactionId: z.string().max(255).nullable().optional(),
  paymentDate: z.coerce.date().optional(),
  notes: z.string().max(65_535).nullable().optional(),
  /** Splits an overpayment: the balance is allocated, the rest goes on account. */
  splitExcess: z.boolean().optional(),
});

export const GET = withAuth(PERMISSIONS.BILLING_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const patientId = url.searchParams.get('patientId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const filters = [];
  if (branchIds) filters.push(inArray(payments.branchId, branchIds));
  if (patientId) filters.push(eq(payments.patientId, patientId));
  if (from) filters.push(gte(payments.paymentDate, new Date(from)));
  if (to) filters.push(lte(payments.paymentDate, new Date(to)));

  const rows = await db
    .select()
    .from(payments)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(payments.paymentDate))
    .limit(200);

  return NextResponse.json(rows);
});

export const POST = withAuth(PERMISSIONS.PAYMENTS_RECORD, async (req, ctx) => {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Refunding needs a stronger permission than taking money.
  if (input.type === PAYMENT_TYPE.REFUND && !ctx.can(PERMISSIONS.PAYMENTS_REFUND)) {
    return NextResponse.json(
      { error: 'You do not have permission to issue refunds.', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  const patient = await loadPatient(ctx, input.patientId);
  const now = input.paymentDate ?? clinicNow();

  let invoice = null;
  if (input.invoiceId) {
    invoice = await loadInvoice(ctx, input.invoiceId);
    if (invoice.patientId !== patient.id) {
      return NextResponse.json(
        { error: 'That invoice belongs to another patient.' },
        { status: 400 }
      );
    }
  }

  const base = {
    patientId: patient.id,
    branchId: patient.branchId,
    type: input.type,
    method: input.method ?? null,
    transactionId: input.transactionId ?? null,
    paymentDate: now,
    notes: input.notes ?? null,
    recordedBy: ctx.userId,
    createdAt: now,
  };

  const rows: (typeof base & { id: string; invoiceId: string | null; amount: number })[] = [];

  if (invoice && input.type === PAYMENT_TYPE.PAYMENT) {
    const balance = invoiceBalance({
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount ?? 0,
    });

    if (input.amount > balance && balance > 0) {
      if (!input.splitExcess) {
        return NextResponse.json(
          {
            error: `That is more than the ${balance} outstanding on this invoice.`,
            code: 'OVERPAYMENT',
            balance,
          },
          { status: 400 }
        );
      }
      // The natural front-desk case: "here's 10,000 against a 7,500 bill".
      // Two rows, so the invoice settles exactly and the rest is visible
      // credit rather than an invoice that reads as overpaid.
      rows.push({ ...base, id: uuidv4(), invoiceId: invoice.id, amount: balance });
      rows.push({ ...base, id: uuidv4(), invoiceId: null, amount: input.amount - balance });
    } else {
      rows.push({ ...base, id: uuidv4(), invoiceId: invoice.id, amount: input.amount });
    }
  } else {
    rows.push({ ...base, id: uuidv4(), invoiceId: invoice?.id ?? null, amount: input.amount });
  }

  const result = await db.transaction(async (tx) => {
    await tx.insert(payments).values(rows);
    // invoices.paidAmount and status are denormalised; recompute in the same
    // transaction so a rollback cannot leave them describing these rows.
    return invoice ? recomputeInvoice(invoice.id, tx) : null;
  });

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.PAYMENT,
    entityId: rows[0]!.id,
    patientId: patient.id,
    branchId: patient.branchId,
    after: { payments: rows, invoice: result },
    request: req,
  });

  return NextResponse.json({ payments: rows, invoice: result }, { status: 201 });
});
