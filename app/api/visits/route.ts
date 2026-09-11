import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, patients, visits } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadAppointment, loadPatient } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  APPOINTMENT_STATUS,
  AUDIT_ACTION,
  AUDIT_ENTITY,
  VISIT_STATUS,
} from '@/lib/enums';
import {
  advanceAppointment,
  type AppointmentAdvanceResult,
} from '@/lib/appointment-lifecycle';
import { parsePageParams, paginate } from '@/lib/pagination';
import { clinicNow } from '@/lib/datetime';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const createSchema = z.object({
  patientId: z.string().min(1).max(255),
  dentistId: z.string().min(1).max(255),
  appointmentId: z.string().max(255).nullable().optional(),
  visitDate: z.coerce.date().optional(),
  chiefComplaint: z.string().max(65_535).nullable().optional(),
});

export const GET = withAuth(PERMISSIONS.CLINICAL_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const page = parsePageParams(url);
  const patientId = url.searchParams.get('patientId');
  const status = url.searchParams.get('status');

  const filters = [];
  if (branchIds) filters.push(inArray(visits.branchId, branchIds));
  if (patientId) filters.push(eq(visits.patientId, patientId));
  if (status && status !== 'all') filters.push(eq(visits.status, status));
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: visits.id,
        visitDate: visits.visitDate,
        status: visits.status,
        chiefComplaint: visits.chiefComplaint,
        patientId: visits.patientId,
        patientMrn: patients.mrn,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        dentistName: adminUsers.name,
      })
      .from(visits)
      .leftJoin(patients, eq(visits.patientId, patients.id))
      .leftJoin(adminUsers, eq(visits.dentistId, adminUsers.id))
      .where(where)
      .orderBy(desc(visits.visitDate))
      .limit(page.pageSize)
      .offset(page.offset),
    db.select({ n: sql<number>`count(*)` }).from(visits).where(where),
  ]);

  return NextResponse.json(paginate(rows, Number(counted?.n ?? 0), page));
});

export const POST = withAuth(PERMISSIONS.CLINICAL_EDIT, async (req, ctx) => {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const patient = await loadPatient(ctx, input.patientId);

  // The appointment is branch-checked too, not just the patient. Without this
  // a client-supplied appointmentId reaches the UPDATE below unvalidated, and
  // any clinical_edit user could move another branch's appointment — which,
  // because in_progress blocks a slot, would also take out their chair.
  if (input.appointmentId) {
    const appointment = await loadAppointment(ctx, input.appointmentId);
    if (appointment.patientId !== patient.id) {
      return NextResponse.json(
        { error: 'That appointment belongs to another patient.' },
        { status: 400 }
      );
    }
  }

  const now = clinicNow();

  const row = {
    id: uuidv4(),
    patientId: patient.id,
    branchId: patient.branchId,
    appointmentId: input.appointmentId ?? null,
    dentistId: input.dentistId,
    visitDate: input.visitDate ?? now,
    chiefComplaint: input.chiefComplaint ?? null,
    examinationNotes: null,
    treatmentNotes: null,
    bloodPressure: null,
    followUpInstructions: null,
    status: VISIT_STATUS.IN_PROGRESS,
    createdAt: now,
    updatedAt: now,
  };

  const opening = await db.transaction(async (tx): Promise<AppointmentAdvanceResult | null> => {
    await tx.insert(visits).values(row);

    // Opening a visit is what "in progress" means for the appointment. The
    // schema has no in-progress timestamp, so the visit's own createdAt is
    // the record of when work started.
    //
    // Through the lifecycle helper so the transition is checked: a patient
    // nobody checked in gets a truthful checkedInAt on the way past, and a
    // cancelled or completed appointment is no longer dragged back into the
    // chair-availability set.
    if (input.appointmentId) {
      return advanceAppointment(tx, {
        appointmentId: input.appointmentId,
        to: APPOINTMENT_STATUS.IN_PROGRESS,
        actor: ctx,
        now,
        request: req,
      });
    }

    return null;
  });

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.VISIT,
    entityId: row.id,
    patientId: patient.id,
    branchId: patient.branchId,
    after: row,
    request: req,
  });

  // `warnings` mirrors POST /api/appointments: the visit is recorded either
  // way, but if the appointment could not follow it the desk should hear so.
  return NextResponse.json({ ...row, warnings: opening?.warnings ?? [] }, { status: 201 });
});
