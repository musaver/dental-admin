import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  adminUsers,
  appointments,
  patients,
  prescriptionItems,
  prescriptions,
  procedures,
  visitDiagnoses,
  visitProcedures,
  visits,
} from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
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
import { asc, eq, inArray } from 'drizzle-orm';
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
  const visit = await loadVisit(ctx, id);

  const [performed, diagnoses, rxHeaders, [patient], [dentist]] = await Promise.all([
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
  ]);

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
    procedures: performed,
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

  await db.transaction(async (tx) => {
    await tx.update(visits).set(patch).where(eq(visits.id, id));

    if (completing) {
      // Close the appointment out alongside the visit, so the diary and the
      // clinical record agree about what happened.
      if (before.appointmentId) {
        await tx
          .update(appointments)
          .set({
            status: APPOINTMENT_STATUS.COMPLETED,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(appointments.id, before.appointmentId));
      }

      // Procedures with a defaultRecallMonths generate the patient's next
      // recall. Idempotent and de-duplicated — see lib/recalls.ts.
      await generateRecallsForVisit(tx, id, ctx.userId);
    }
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
    after,
    request: req,
  });

  return NextResponse.json(after);
});
