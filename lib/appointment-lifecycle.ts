import { db } from '@/lib/db';
import { appointments } from '@/lib/schema';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY, APPOINTMENT_STATUS, humanize } from '@/lib/enums';
import type { AppointmentStatus } from '@/lib/enums';
import { applyStatusPath, statusPath } from '@/lib/appointments';
import { completeRecallForAppointment } from '@/lib/recalls';
import type { StaffContext } from '@/lib/rbac';
import { eq } from 'drizzle-orm';

/**
 * Moving an appointment in response to a clinical event.
 *
 * Two routes reach `completed`: a human pressing a status button
 * (app/api/appointments/[id]/status/route.ts), and a dentist completing the
 * visit. The first is a deliberate act and rightly gets a 409 for an illegal
 * transition. The second is not — a clinician must never be blocked because
 * the front desk forgot to press "check in" — so this walks the shortest legal
 * route instead, stamping every timestamp on the way so the timeline has no
 * holes.
 *
 * Before this existed the visit route wrote `status`/`completedAt` straight
 * onto the row, which skipped canTransition(), skipped the timestamp backfill,
 * and wrote no audit entry for the appointment at all. CONVENTIONS.md
 * ("Lifecycles") requires all three.
 *
 * This module rather than lib/derive.ts: that file's charter is the seven
 * denormalised rollups and the five pointer pairs, and appointment lifecycle
 * is neither. Not lib/recalls.ts either, which would invert the dependency.
 * The shape follows lib/patient-registration.ts — a small db module that joins
 * the caller's transaction and writes its own audit row into it.
 */

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AppointmentAdvanceOutcome =
  /** Status moved, timestamps stamped, audit written. */
  | 'advanced'
  /** Already at the target — nothing written, but a stale recall is still closed. */
  | 'already'
  /** No legal route (only ever a cancelled appointment). Left untouched. */
  | 'blocked'
  /** No such appointment. */
  | 'missing';

export interface AppointmentAdvanceResult {
  outcome: AppointmentAdvanceOutcome;
  from: string | null;
  to: AppointmentStatus;
  recallClosedId: string | null;
  /** Front-desk readable; empty on the happy path. */
  warnings: string[];
}

export interface AdvanceAppointmentOptions {
  appointmentId: string;
  to: AppointmentStatus;
  actor: Pick<StaffContext, 'userId' | 'email'>;
  now: Date;
  request?: Request | null;
}

/**
 * Walk an appointment to `to`, or explain why it stayed put.
 *
 * Never throws for a status it cannot reach: the caller is recording clinical
 * work that has already happened, and failing that write to protect a diary
 * field would be the wrong trade. A blocked appointment comes back as a
 * warning for the front desk instead.
 *
 * The caller must pass its own `tx` and its own `now`, so the appointment, the
 * visit and the recall all name the same instant.
 */
export async function advanceAppointment(
  tx: Executor,
  options: AdvanceAppointmentOptions
): Promise<AppointmentAdvanceResult> {
  const { appointmentId, to, actor, now, request } = options;

  const [before] = await tx
    .select({
      id: appointments.id,
      status: appointments.status,
      patientId: appointments.patientId,
      branchId: appointments.branchId,
      recallId: appointments.recallId,
      confirmedAt: appointments.confirmedAt,
      checkedInAt: appointments.checkedInAt,
    })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);

  const base = { from: before?.status ?? null, to, recallClosedId: null, warnings: [] as string[] };

  if (!before) return { ...base, outcome: 'missing' };

  const path = statusPath(before.status, to);

  if (path === null) {
    // Only ever a cancelled appointment: the desk rebooks rather than
    // resurrecting one, so the cancellation stays in the record and in the
    // reporting. Say so rather than failing silently.
    return {
      ...base,
      outcome: 'blocked',
      warnings: [
        `The appointment was already ${humanize(before.status).toLowerCase()}, so it was left as it is.`,
      ],
    };
  }

  // Closing the recall runs even when the status is already right, so an
  // appointment completed before this shipped self-heals next time it is
  // touched.
  const closedRecall =
    to === APPOINTMENT_STATUS.COMPLETED && before.recallId
      ? await completeRecallForAppointment(tx, before.recallId, appointmentId)
      : false;
  const recallClosedId = closedRecall ? before.recallId : null;

  if (path.length === 0) {
    return { ...base, outcome: 'already', recallClosedId };
  }

  const patch = applyStatusPath({
    from: before.status,
    path,
    now,
    actorId: actor.userId,
    existing: { confirmedAt: before.confirmedAt, checkedInAt: before.checkedInAt },
  });

  await tx
    .update(appointments)
    .set({ ...patch, updatedAt: now })
    .where(eq(appointments.id, appointmentId));

  await writeAuditLog(
    {
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: AUDIT_ENTITY.APPOINTMENT,
      entityId: appointmentId,
      patientId: before.patientId,
      branchId: before.branchId,
      before: { status: before.status },
      after: { status: patch.status, ...(recallClosedId ? { recallClosedId } : {}) },
      request: request ?? null,
    },
    tx
  );

  return { ...base, outcome: 'advanced', recallClosedId };
}
