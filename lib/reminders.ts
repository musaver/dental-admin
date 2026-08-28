import { db } from '@/lib/db';
import { adminUsers, appointments, patients, recalls } from '@/lib/schema';
import { sendTemplatedEmail } from '@/lib/communications';
import { getReferenceCommunications } from '@/lib/communications';
import {
  APPOINTMENT_STATUS,
  COMM_REFERENCE_TYPE,
  RECALL_STATUS,
} from '@/lib/enums';
import { addDays, clinicNow, endOfDay, fmtDateTime, startOfDay } from '@/lib/datetime';
import { patientName } from '@/lib/patient-identity';
import { humanize } from '@/lib/enums';
import { and, eq, gte, inArray, isNull, lt, lte } from 'drizzle-orm';

/**
 * Reminder jobs.
 *
 * The model is "every morning, send tomorrow's list" rather than
 * "exactly 24 hours before each appointment": one daily run is simple to
 * reason about, matches how a clinic actually works, and a manual button on
 * the diary can always send the same batch on demand.
 *
 * Idempotency:
 *   appointments — the reminderEmailSentAt column. Rescheduling clears it, so
 *   a moved appointment gets a fresh reminder for its NEW time.
 *   recalls — no such column exists, so the guard is a communication_logs
 *   lookup by referenceType/referenceId, which is precisely what those
 *   polymorphic columns are for.
 */

/** Caps one run, so a backlog cannot blow the serverless time budget. */
const BATCH_LIMIT = 50;

export interface ReminderRunResult {
  eligible: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Rows left for the next run, when the batch cap was hit. */
  remaining: number;
}

/** Appointment reminders for [from, to). Defaults to "tomorrow". */
export async function sendAppointmentReminders(options: {
  from?: Date;
  to?: Date;
  limit?: number;
} = {}): Promise<ReminderRunResult> {
  const now = clinicNow();
  const from = options.from ?? startOfDay(addDays(now, 1));
  const to = options.to ?? endOfDay(addDays(now, 1));
  const limit = options.limit ?? BATCH_LIMIT;

  const due = await db
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      branchId: appointments.branchId,
      patientId: appointments.patientId,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      patientEmail: patients.email,
      dentistName: adminUsers.name,
    })
    .from(appointments)
    .leftJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(adminUsers, eq(appointments.dentistId, adminUsers.id))
    .where(
      and(
        inArray(appointments.status, [
          APPOINTMENT_STATUS.SCHEDULED,
          APPOINTMENT_STATUS.CONFIRMED,
        ]),
        gte(appointments.startAt, from),
        lt(appointments.startAt, to),
        // The idempotency guard.
        isNull(appointments.reminderEmailSentAt)
      )
    )
    .orderBy(appointments.startAt)
    .limit(limit + 1);

  const batch = due.slice(0, limit);
  const remaining = Math.max(0, due.length - batch.length);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Sequential, deliberately: 50 parallel Brevo calls from a serverless
  // function is a rate-limit incident, not a speedup.
  for (const appointment of batch) {
    const outcome = await sendTemplatedEmail({
      to: appointment.patientEmail,
      templateKey: 'appointment_reminder',
      vars: {
        patientName: patientName({
          firstName: appointment.patientFirstName ?? 'Patient',
          lastName: appointment.patientLastName,
        }),
        dateTime: fmtDateTime(appointment.startAt),
        dentistName: appointment.dentistName ?? 'your dentist',
      },
      patientId: appointment.patientId,
      branchId: appointment.branchId,
      referenceType: COMM_REFERENCE_TYPE.APPOINTMENT,
      referenceId: appointment.id,
    });

    if (outcome.status === 'sent') {
      sent++;
      // Stamped only on success: a failed send retries next run.
      await db
        .update(appointments)
        .set({ reminderEmailSentAt: clinicNow(), updatedAt: clinicNow() })
        .where(eq(appointments.id, appointment.id));
    } else if (outcome.status === 'skipped') {
      skipped++;
      // No email on file. The skipped log rows ARE the front desk's
      // "phone these people" list — do not stamp, so they stay visible.
    } else {
      failed++;
    }
  }

  return { eligible: due.length, sent, skipped, failed, remaining };
}

/** Recall reminders for everything pending and due. */
export async function sendRecallReminders(options: { limit?: number } = {}): Promise<ReminderRunResult> {
  const now = clinicNow();
  const limit = options.limit ?? BATCH_LIMIT;

  const due = await db
    .select({
      id: recalls.id,
      recallType: recalls.recallType,
      branchId: recalls.branchId,
      patientId: recalls.patientId,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      patientEmail: patients.email,
    })
    .from(recalls)
    .leftJoin(patients, eq(recalls.patientId, patients.id))
    .where(and(eq(recalls.status, RECALL_STATUS.PENDING), lte(recalls.dueDate, now)))
    .orderBy(recalls.dueDate)
    .limit(limit + 1);

  const batch = due.slice(0, limit);
  const remaining = Math.max(0, due.length - batch.length);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const recall of batch) {
    // The idempotency guard: recalls have no sent-at column, so the log is it.
    const previous = await getReferenceCommunications(COMM_REFERENCE_TYPE.RECALL, recall.id);
    const recentlySent = previous.some(
      (row) =>
        row.status === 'sent' &&
        row.createdAt &&
        now.getTime() - row.createdAt.getTime() < 14 * 86_400_000
    );
    if (recentlySent) {
      skipped++;
      continue;
    }

    const outcome = await sendTemplatedEmail({
      to: recall.patientEmail,
      templateKey: 'recall_due',
      vars: {
        patientName: patientName({
          firstName: recall.patientFirstName ?? 'Patient',
          lastName: recall.patientLastName,
        }),
        recallType: humanize(recall.recallType),
      },
      patientId: recall.patientId,
      branchId: recall.branchId,
      referenceType: COMM_REFERENCE_TYPE.RECALL,
      referenceId: recall.id,
    });

    if (outcome.status === 'sent') sent++;
    else if (outcome.status === 'skipped') skipped++;
    else failed++;
  }

  return { eligible: due.length, sent, skipped, failed, remaining };
}
