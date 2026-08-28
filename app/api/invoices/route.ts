import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { invoices, patients } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadPatient, loadTreatmentPlan, loadVisit } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import {
  buildLinesFromTreatmentPlan,
  buildLinesFromVisit,
  createInvoice,
  isDuplicateInvoiceNumber,
  INVOICE_NUMBER_RETRIES,
  type DraftLine,
} from '@/lib/invoices';
import { parsePageParams, paginate } from '@/lib/pagination';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

const manualLine = z.object({
  description: z.string().trim().min(1).max(255),
  quantity: z.coerce.number().int().min(1).default(1),
  unitPrice: z.coerce.number().int(),
  discountAmount: z.coerce.number().int().min(0).default(0),
  itemType: z.string().max(20).default('procedure'),
  procedureId: z.string().max(255).nullable().optional(),
  teeth: z.string().max(100).nullable().optional(),
});

const createSchema = z.object({
  patientId: z.string().min(1).max(255),
  /** Exactly one source: a visit, a plan, or explicit lines. */
  visitId: z.string().max(255).nullable().optional(),
  treatmentPlanId: z.string().max(255).nullable().optional(),
  treatmentPlanItemIds: z.array(z.string()).optional(),
  lines: z.array(manualLine).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().max(65_535).nullable().optional(),
  applyPatientDiscount: z.boolean().optional(),
});

export const GET = withAuth(PERMISSIONS.BILLING_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const page = parsePageParams(url);
  const patientId = url.searchParams.get('patientId');
  const status = url.searchParams.get('status');

  const filters = [];
  if (branchIds) filters.push(inArray(invoices.branchId, branchIds));
  if (patientId) filters.push(eq(invoices.patientId, patientId));
  if (status && status !== 'all') filters.push(inArray(invoices.status, status.split(',')));
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        subtotal: invoices.subtotal,
        discountTotal: invoices.discountTotal,
        totalAmount: invoices.totalAmount,
        paidAmount: invoices.paidAmount,
        status: invoices.status,
        patientId: invoices.patientId,
        patientMrn: patients.mrn,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
      })
      .from(invoices)
      .leftJoin(patients, eq(invoices.patientId, patients.id))
      .where(where)
      .orderBy(desc(invoices.issueDate))
      .limit(page.pageSize)
      .offset(page.offset),
    db.select({ n: sql<number>`count(*)` }).from(invoices).where(where),
  ]);

  return NextResponse.json(paginate(rows, Number(counted?.n ?? 0), page));
});

export const POST = withAuth(PERMISSIONS.BILLING_CREATE, async (req, ctx) => {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const patient = await loadPatient(ctx, input.patientId);

  // Branch comes from the patient; a visit or plan must belong to them.
  if (input.visitId) {
    const visit = await loadVisit(ctx, input.visitId);
    if (visit.patientId !== patient.id) {
      return NextResponse.json({ error: 'That visit belongs to another patient.' }, { status: 400 });
    }
  }
  if (input.treatmentPlanId) {
    const plan = await loadTreatmentPlan(ctx, input.treatmentPlanId);
    if (plan.patientId !== patient.id) {
      return NextResponse.json({ error: 'That plan belongs to another patient.' }, { status: 400 });
    }
  }

  for (let attempt = 1; attempt <= INVOICE_NUMBER_RETRIES; attempt++) {
    try {
      const created = await db.transaction(async (tx) => {
        let lines: DraftLine[] = [];

        if (input.visitId) {
          lines = await buildLinesFromVisit(tx, input.visitId);
        } else if (input.treatmentPlanId) {
          lines = await buildLinesFromTreatmentPlan(
            tx,
            input.treatmentPlanId,
            input.treatmentPlanItemIds
          );
        } else if (input.lines?.length) {
          lines = input.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountAmount: l.discountAmount,
            itemType: l.itemType,
            teeth: l.teeth ?? null,
            procedureId: l.procedureId ?? null,
          }));
        }

        if (!lines.length) {
          // Everything eligible was already billed, or nothing was supplied.
          throw Object.assign(new Error('NOTHING_TO_INVOICE'), { nothingToInvoice: true });
        }

        return createInvoice(tx, {
          patientId: patient.id,
          branchId: patient.branchId,
          visitId: input.visitId ?? null,
          treatmentPlanId: input.treatmentPlanId ?? null,
          dueDate: input.dueDate ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
          lines,
          applyPatientDiscount: input.applyPatientDiscount ?? true,
        });
      });

      await writeAuditLog({
        actor: ctx,
        action: AUDIT_ACTION.CREATE,
        entityType: AUDIT_ENTITY.INVOICE,
        entityId: created.invoice.id,
        patientId: patient.id,
        branchId: patient.branchId,
        after: created.invoice,
        request: req,
      });

      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      if ((error as { nothingToInvoice?: boolean }).nothingToInvoice) {
        return NextResponse.json(
          {
            error: 'There is nothing left to invoice — this work has already been billed.',
            code: 'NOTHING_TO_INVOICE',
          },
          { status: 409 }
        );
      }
      // Another invoice took the same number between our read and write.
      if (isDuplicateInvoiceNumber(error) && attempt < INVOICE_NUMBER_RETRIES) continue;
      throw error;
    }
  }

  return NextResponse.json(
    { error: 'Could not allocate an invoice number. Please try again.' },
    { status: 409 }
  );
});
