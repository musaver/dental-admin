import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, appointments, patients, visits } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadPatient } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  APPOINTMENT_STATUS,
  AUDIT_ACTION,
  AUDIT_ENTITY,
  VISIT_STATUS,
} from '@/lib/enums';
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

  await db.transaction(async (tx) => {
    await tx.insert(visits).values(row);

    // Opening a visit is what "in progress" means for the appointment. The
    // schema has no in-progress timestamp, so the visit's own createdAt is
    // the record of when work started.
    if (input.appointmentId) {
      await tx
        .update(appointments)
        .set({ status: APPOINTMENT_STATUS.IN_PROGRESS, updatedAt: now })
        .where(eq(appointments.id, input.appointmentId));
    }
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

  return NextResponse.json(row, { status: 201 });
});
