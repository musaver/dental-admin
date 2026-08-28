import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, appointments, chairs, patients, procedures } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadPatient } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  APPOINTMENT_STATUS,
  APPOINTMENT_TYPE,
  AUDIT_ACTION,
  AUDIT_ENTITY,
  valuesOf,
} from '@/lib/enums';
import { checkConflicts, describeWarnings } from '@/lib/availability';
import { linkAppointmentToPlanItem } from '@/lib/derive';
import { linkRecallToAppointment } from '@/lib/recalls';
import { clinicNow } from '@/lib/datetime';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const createSchema = z.object({
  patientId: z.string().min(1).max(255),
  dentistId: z.string().min(1).max(255),
  chairId: z.string().max(255).nullable().optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  type: z.enum(valuesOf(APPOINTMENT_TYPE) as [string, ...string[]]).optional(),
  isWalkIn: z.boolean().optional(),
  reasonNote: z.string().max(500).nullable().optional(),
  treatmentPlanItemId: z.string().max(255).nullable().optional(),
  recallId: z.string().max(255).nullable().optional(),
  /** Books over a clash. Requires appointments_edit and is audited. */
  allowOverlap: z.boolean().optional(),
});

export const GET = withAuth(PERMISSIONS.APPOINTMENTS_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const patientId = url.searchParams.get('patientId');
  const dentistId = url.searchParams.get('dentistId');
  const status = url.searchParams.get('status');

  const filters = [];
  if (branchIds) filters.push(inArray(appointments.branchId, branchIds));
  if (patientId) filters.push(eq(appointments.patientId, patientId));
  if (dentistId) filters.push(eq(appointments.dentistId, dentistId));
  if (status) filters.push(inArray(appointments.status, status.split(',')));
  if (from) filters.push(gte(appointments.startAt, new Date(from)));
  if (to) filters.push(lt(appointments.startAt, new Date(to)));

  const rows = await db
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      type: appointments.type,
      status: appointments.status,
      isWalkIn: appointments.isWalkIn,
      reasonNote: appointments.reasonNote,
      checkedInAt: appointments.checkedInAt,
      confirmedAt: appointments.confirmedAt,
      completedAt: appointments.completedAt,
      chairId: appointments.chairId,
      chairName: chairs.name,
      dentistId: appointments.dentistId,
      dentistName: adminUsers.name,
      patientId: appointments.patientId,
      patientMrn: patients.mrn,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      patientPhone: patients.phone,
      patientHasAlerts: patients.hasAlerts,
      treatmentPlanItemId: appointments.treatmentPlanItemId,
      recallId: appointments.recallId,
    })
    .from(appointments)
    .leftJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(adminUsers, eq(appointments.dentistId, adminUsers.id))
    .leftJoin(chairs, eq(appointments.chairId, chairs.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(appointments.startAt);

  return NextResponse.json(rows);
});

export const POST = withAuth(PERMISSIONS.APPOINTMENTS_CREATE, async (req, ctx) => {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const input = parsed.data;

  if (input.endAt <= input.startAt) {
    return NextResponse.json(
      { error: 'The appointment must end after it starts.', details: { endAt: ['Invalid'] } },
      { status: 400 }
    );
  }

  const patient = await loadPatient(ctx, input.patientId);
  const now = clinicNow();

  const row = {
    id: uuidv4(),
    patientId: patient.id,
    branchId: patient.branchId,
    dentistId: input.dentistId,
    chairId: input.chairId ?? null,
    startAt: input.startAt,
    endAt: input.endAt,
    type: input.type ?? APPOINTMENT_TYPE.PROCEDURE,
    status: APPOINTMENT_STATUS.SCHEDULED,
    isWalkIn: input.isWalkIn ?? false,
    treatmentPlanItemId: null as string | null,
    recallId: null as string | null,
    reasonNote: input.reasonNote ?? null,
    cancellationReason: null,
    cancelledBy: null,
    cancelledAt: null,
    confirmedAt: null,
    checkedInAt: null,
    completedAt: null,
    reminderEmailSentAt: null,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };

  let warnings: string[] = [];

  try {
    await db.transaction(async (tx) => {
      // The conflict check MUST run inside the transaction. Checking first and
      // inserting after leaves a window for another booking to land in — and
      // MySQL has no exclusion constraint to catch it.
      const conflicts = await checkConflicts(
        {
          branchId: patient.branchId,
          dentistId: input.dentistId,
          chairId: input.chairId ?? null,
          startAt: input.startAt,
          endAt: input.endAt,
        },
        tx
      );

      if (conflicts.blocking && !input.allowOverlap) {
        throw Object.assign(new Error('CONFLICT'), { conflicts });
      }

      warnings = describeWarnings(conflicts);
      if (conflicts.blocking && input.allowOverlap) {
        warnings.push('Booked over an existing appointment.');
      }

      await tx.insert(appointments).values(row);

      // Both link pairs are written here so neither side can be left dangling.
      if (input.treatmentPlanItemId) {
        await linkAppointmentToPlanItem(tx, row.id, input.treatmentPlanItemId);
      }
      if (input.recallId) {
        await linkRecallToAppointment(tx, input.recallId, row.id);
      }
    });
  } catch (error) {
    const conflicts = (error as { conflicts?: unknown }).conflicts;
    if (conflicts) {
      return NextResponse.json(
        {
          error: 'That time is already booked.',
          code: 'APPOINTMENT_CONFLICT',
          conflicts,
        },
        { status: 409 }
      );
    }
    throw error;
  }

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.APPOINTMENT,
    entityId: row.id,
    patientId: patient.id,
    branchId: patient.branchId,
    after: { ...row, overrode: input.allowOverlap ?? false },
    request: req,
  });

  return NextResponse.json({ appointment: row, warnings }, { status: 201 });
});
