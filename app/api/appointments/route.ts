import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, appointments, chairs, patients, procedures } from '@/lib/schema';
import { withAuth, resolveBranchScope, resolveWritingBranch } from '@/lib/rbac';
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
import { findDuplicatePatients, isDuplicateKeyError, normalizePhone } from '@/lib/patients';
import {
  branchExists,
  insertPatient,
  MRN_RETRIES,
  type PatientRow,
} from '@/lib/patient-registration';
import { patientCreateSchema, fieldErrors } from '@/lib/validation/patient';
import { linkAppointmentToPlanItem } from '@/lib/derive';
import { linkRecallToAppointment } from '@/lib/recalls';
import { clinicNow } from '@/lib/datetime';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

/**
 * What the front desk can collect while someone is on the phone.
 *
 * firstName and phone are the two the patients table requires; email makes the
 * reminder possible, and lastName + dateOfBirth are what duplicate detection
 * matches on beyond the number. Everything else belongs on the chart, later.
 */
const newPatientSchema = patientCreateSchema.pick({
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  gender: true,
  dateOfBirth: true,
  branchId: true,
  allowDuplicate: true,
});

const createSchema = z
  .object({
    patientId: z.string().min(1).max(255).optional(),
    /**
     * Register the patient as part of the booking, for someone who has never
     * been seen before. Requires patients_create.
     */
    newPatient: newPatientSchema.optional(),
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
  })
  // Exactly one, never both: two sources for the same patient is how you end
  // up booking one person and registering another.
  .refine((v) => Boolean(v.patientId) !== Boolean(v.newPatient), {
    message: 'Choose an existing patient, or give the details of a new one.',
    path: ['patientId'],
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

/**
 * Book an appointment, for an existing patient or a brand new one.
 *
 * The new-patient path exists because the front desk meets people who have
 * never been seen before, and making them register first meant the booking
 * simply could not be made. Patient and appointment are created in ONE
 * transaction, so a chair clash rolls the registration back too — otherwise a
 * refused booking would leave a patient on the register for a visit that never
 * existed, and the desk would register them again on the retry.
 */
export const POST = withAuth(PERMISSIONS.APPOINTMENTS_CREATE, async (req, ctx) => {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: fieldErrors(parsed.error) },
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

  // Existing patient: unchanged, 404 for unknown or another branch's.
  const existing = input.patientId ? await loadPatient(ctx, input.patientId) : null;

  let registrationBranchId: string | null = null;

  if (input.newPatient) {
    // Booking and registering are separate rights; holding one does not grant
    // the other. Same check as converting a lead.
    if (!ctx.can(PERMISSIONS.PATIENTS_CREATE)) {
      return NextResponse.json(
        {
          error: 'You need permission to register patients to book someone new.',
          code: 'FORBIDDEN',
        },
        { status: 403 }
      );
    }

    registrationBranchId = resolveWritingBranch(ctx, input.newPatient.branchId);
    if (!registrationBranchId) {
      return NextResponse.json(
        {
          error: 'Choose which branch is registering this patient.',
          details: { 'newPatient.branchId': ['Required'] },
        },
        { status: 400 }
      );
    }

    if (!(await branchExists(registrationBranchId))) {
      return NextResponse.json({ error: 'That branch does not exist.' }, { status: 400 });
    }

    // Advisory, not blocking — see POST /api/patients. Nothing has been
    // written yet, so answering here costs the caller nothing.
    if (!input.newPatient.allowDuplicate) {
      const duplicates = await findDuplicatePatients(
        {
          phone: normalizePhone(input.newPatient.phone),
          firstName: input.newPatient.firstName,
          lastName: input.newPatient.lastName,
          dateOfBirth: input.newPatient.dateOfBirth,
        },
        { branchIds: ctx.isHeadOffice ? null : [ctx.branchId!] }
      );
      if (duplicates.length) {
        return NextResponse.json(
          {
            error: 'This may already be an existing patient.',
            code: 'POSSIBLE_DUPLICATE',
            duplicates,
          },
          { status: 409 }
        );
      }
    }
  }

  const now = clinicNow();

  let booked: {
    row: typeof appointments.$inferInsert & { id: string };
    patient: { id: string; branchId: string };
    registered: PatientRow | null;
    warnings: string[];
  } | null = null;

  // The loop is the MRN retry: nextMrn() reads the highest number for the
  // branch, so a lost race surfaces as a duplicate-key error and is worth one
  // more attempt. With no patient to register there is nothing to retry.
  for (let attempt = 1; attempt <= MRN_RETRIES; attempt++) {
    try {
      booked = await db.transaction(async (tx) => {
        const registered = existing
          ? null
          : await insertPatient(tx, {
              input: input.newPatient!,
              branchId: registrationBranchId!,
              actor: ctx,
              now,
              request: req,
            });
        const patient = existing ?? registered!;

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

        const warnings = describeWarnings(conflicts);
        if (conflicts.blocking && input.allowOverlap) {
          warnings.push('Booked over an existing appointment.');
        }

        // Built here, not above, because a patient registered as part of this
        // booking has no id until the line above ran.
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

        await tx.insert(appointments).values(row);

        // Both link pairs are written here so neither side can be left dangling.
        if (input.treatmentPlanItemId) {
          await linkAppointmentToPlanItem(tx, row.id, input.treatmentPlanItemId);
        }
        if (input.recallId) {
          await linkRecallToAppointment(tx, input.recallId, row.id);
        }

        return { row, patient, registered, warnings };
      });
      break;
    } catch (error) {
      // Another registration took the same MRN between our read and write.
      if (!existing && isDuplicateKeyError(error) && attempt < MRN_RETRIES) continue;

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
  }

  if (!booked) {
    return NextResponse.json(
      { error: 'Could not allocate a medical record number. Please try again.' },
      { status: 409 }
    );
  }

  // The patient's own audit entry is written inside the transaction by
  // insertPatient(), so a rollback takes it with them.
  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.APPOINTMENT,
    entityId: booked.row.id,
    patientId: booked.patient.id,
    branchId: booked.patient.branchId,
    after: { ...booked.row, overrode: input.allowOverlap ?? false },
    request: req,
  });

  return NextResponse.json(
    { appointment: booked.row, patient: booked.registered, warnings: booked.warnings },
    { status: 201 }
  );
});
