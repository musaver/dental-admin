import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  adminUsers,
  invoiceItems,
  invoices,
  patients,
  prescriptionItems,
  prescriptions,
  procedures,
  visitDiagnoses,
  visitProcedures,
  visits,
} from '@/lib/schema';
import {
  advanceAppointment,
  type AppointmentAdvanceResult,
} from '@/lib/appointment-lifecycle';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { loadVisit } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  APPOINTMENT_STATUS,
  AUDIT_ACTION,
  AUDIT_ENTITY,
  VISIT_STATUS,
  valuesOf,
} from '@/lib/enums';
import { generateRecallsForVisit } from '@/lib/recalls';
import { clinicNow } from '@/lib/datetime';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

const updateSchema = z.object({
  chiefComplaint: z.string().max(65_535).nullable().optional(),
  examinationNotes: z.string().max(65_535).nullable().optional(),
  treatmentNotes: z.string().max(65_535).nullable().optional(),
  followUpInstructions: z.string().max(65_535).nullable().optional(),
  bloodPressure: z.string().max(10).nullable().optional(),
  status: z.enum(valuesOf(VISIT_STATUS) as [string, ...string[]]).optional(),
  dentistId: z.string().max(255).optional(),
});

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(PERMISSIONS.CLINICAL_VIEW, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  // loadVisit has already branch-checked the row, so everything below is in
  // scope by construction.
  const visit = await loadVisit(ctx, id);

  // The page shapes itself to the caller's permissions, computed here rather
  // than from the session — same pattern as the patient summary route. Two
  // flags, not one: billing_view reveals the invoices, billing_create is what
  // POST /api/invoices actually enforces.
  const canBilling = hasPermission(ctx.permissions, PERMISSIONS.BILLING_VIEW);
  const canRaiseInvoice = hasPermission(ctx.permissions, PERMISSIONS.BILLING_CREATE);

  const [performed, diagnoses, rxHeaders, [patient], [dentist], raised] = await Promise.all([
    db
      .select({
        id: visitProcedures.id,
        procedureId: visitProcedures.procedureId,
        procedureName: procedures.name,
        isPerTooth: procedures.isPerTooth,
        defaultRecallMonths: procedures.defaultRecallMonths,
        category: procedures.category,
        teeth: visitProcedures.teeth,
        surfaces: visitProcedures.surfaces,
        price: visitProcedures.price,
        status: visitProcedures.status,
        treatmentPlanItemId: visitProcedures.treatmentPlanItemId,
        performedBy: visitProcedures.performedBy,
        performedByName: adminUsers.name,
        notes: visitProcedures.notes,
      })
      .from(visitProcedures)
      .leftJoin(procedures, eq(visitProcedures.procedureId, procedures.id))
      .leftJoin(adminUsers, eq(visitProcedures.performedBy, adminUsers.id))
      .where(eq(visitProcedures.visitId, id))
      .orderBy(asc(visitProcedures.createdAt)),
    db
      .select()
      .from(visitDiagnoses)
      .where(eq(visitDiagnoses.visitId, id))
      .orderBy(asc(visitDiagnoses.createdAt)),
    db.select().from(prescriptions).where(eq(prescriptions.visitId, id)),
    db
      .select({
        id: patients.id,
        mrn: patients.mrn,
        firstName: patients.firstName,
        lastName: patients.lastName,
        dateOfBirth: patients.dateOfBirth,
      })
      .from(patients)
      .where(eq(patients.id, visit.patientId))
      .limit(1),
    db
      .select({
        id: adminUsers.id,
        name: adminUsers.name,
        licenseNumber: adminUsers.licenseNumber,
        signatureUrl: adminUsers.signatureUrl,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, visit.dentistId))
      .limit(1),
    // invoices.visitId is the right link, not invoice_items.visitProcedureId:
    // createInvoice() always stamps it when a visitId was supplied, and the
    // manual-line path cannot carry a visitProcedureId at all — so no invoice
    // bills this visit without pointing at it.
    canBilling
      ? db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            issueDate: invoices.issueDate,
            totalAmount: invoices.totalAmount,
            paidAmount: invoices.paidAmount,
            status: invoices.status,
          })
          .from(invoices)
          .where(eq(invoices.visitId, id))
          .orderBy(desc(invoices.issueDate))
      : Promise.resolve([]),
  ]);

  // Which performed procedures are already on an invoice, so the page can mark
  // them and hide the "Raise invoice" button once there is nothing left.
  //
  // Filtered by inArray, deliberately unlike buildLinesFromVisit(), which
  // reads every invoice_items row with a non-null visitProcedureId in the
  // table. That is fine inside a transaction about to write; it must not
  // become a full index scan on every page load.
  const visitProcedureIds = performed.map((p) => p.id);
  const invoicedIds = new Set(
    canBilling && visitProcedureIds.length
      ? (
          await db
            .select({ visitProcedureId: invoiceItems.visitProcedureId })
            .from(invoiceItems)
            .where(inArray(invoiceItems.visitProcedureId, visitProcedureIds))
        ).map((r) => r.visitProcedureId)
      : []
  );

  const rxIds = rxHeaders.map((r) => r.id);
  const rxLines = rxIds.length
    ? await db
        .select()
        .from(prescriptionItems)
        .where(inArray(prescriptionItems.prescriptionId, rxIds))
        .orderBy(asc(prescriptionItems.sortOrder))
    : [];

  return NextResponse.json({
    visit,
    patient: patient ?? null,
    dentist: dentist ?? null,
    permissions: { billing: canBilling, billingCreate: canRaiseInvoice },
    invoices: raised,
    // Gated on canBilling so a clinical-only viewer learns nothing about
    // money; the button is hidden for them anyway, so the two stay consistent.
    procedures: performed.map((p) => ({ ...p, invoiced: invoicedIds.has(p.id) })),
    diagnoses,
    prescriptions: rxHeaders.map((rx) => ({
      ...rx,
      items: rxLines.filter((line) => line.prescriptionId === rx.id),
    })),
  });
});

export const PUT = withAuth(PERMISSIONS.CLINICAL_EDIT, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const before = await loadVisit(ctx, id);

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const now = clinicNow();

  const patch: Record<string, unknown> = { updatedAt: now };
  for (const field of [
    'chiefComplaint', 'examinationNotes', 'treatmentNotes',
    'followUpInstructions', 'bloodPressure', 'status', 'dentistId',
  ] as const) {
    if (input[field] !== undefined) patch[field] = input[field];
  }

  const completing =
    input.status === VISIT_STATUS.COMPLETED && before.status !== VISIT_STATUS.COMPLETED;

  // Returned out of the transaction so the warnings survive it.
  const completion = await db.transaction(async (tx): Promise<AppointmentAdvanceResult | null> => {
    let advanced: AppointmentAdvanceResult | null = null;

    await tx.update(visits).set(patch).where(eq(visits.id, id));

    if (completing) {
      // Close the appointment out alongside the visit, so the diary and the
      // clinical record agree about what happened. Via the lifecycle helper,
      // not a direct write: it walks the legal path (a patient nobody checked
      // in still gets a truthful checkedInAt), closes any recall the
      // appointment was booked from, and writes the appointment's audit row.
      if (before.appointmentId) {
        advanced = await advanceAppointment(tx, {
          appointmentId: before.appointmentId,
          to: APPOINTMENT_STATUS.COMPLETED,
          actor: ctx,
          now,
          request: req,
        });
      }

      // Procedures with a defaultRecallMonths generate the patient's next
      // recall. Idempotent and de-duplicated — see lib/recalls.ts.
      await generateRecallsForVisit(tx, id, ctx.userId);
    }

    return advanced;
  });

  const after = await loadVisit(ctx, id);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.UPDATE,
    entityType: AUDIT_ENTITY.VISIT,
    entityId: id,
    patientId: before.patientId,
    branchId: before.branchId,
    before,
    after: { ...after, appointmentOutcome: completion?.outcome ?? null },
    request: req,
  });

  // `warnings` mirrors POST /api/appointments — a cancelled appointment is
  // skipped rather than resurrected, and the desk should hear about it.
  return NextResponse.json({ ...after, warnings: completion?.warnings ?? [] });
});
