import { APPOINTMENT_STATUS, type AppointmentStatus } from './enums.ts';

/**
 * Appointment lifecycle — pure, so it is unit tested.
 *
 * The schema records progress twice: as a `status` string AND as parallel
 * timestamps (confirmedAt, checkedInAt, completedAt). Neither derives the
 * other, so both must be written together. applyStatusChange() returns the
 * whole patch to make that impossible to forget.
 */

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  [APPOINTMENT_STATUS.SCHEDULED]: [
    APPOINTMENT_STATUS.CONFIRMED,
    APPOINTMENT_STATUS.CHECKED_IN,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.NO_SHOW,
  ],
  [APPOINTMENT_STATUS.CONFIRMED]: [
    APPOINTMENT_STATUS.CHECKED_IN,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.NO_SHOW,
    APPOINTMENT_STATUS.SCHEDULED,
  ],
  [APPOINTMENT_STATUS.CHECKED_IN]: [
    APPOINTMENT_STATUS.IN_PROGRESS,
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.CANCELLED,
  ],
  [APPOINTMENT_STATUS.IN_PROGRESS]: [
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.CANCELLED,
  ],
  // Terminal.
  [APPOINTMENT_STATUS.COMPLETED]: [],
  // A cancelled appointment is not resurrected; the desk rebooks instead, so
  // the cancellation stays in the record and in the reporting.
  [APPOINTMENT_STATUS.CANCELLED]: [],
  // Correcting a mis-click is legitimate; the patient did turn up after all.
  [APPOINTMENT_STATUS.NO_SHOW]: [APPOINTMENT_STATUS.SCHEDULED, APPOINTMENT_STATUS.CHECKED_IN],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = APPOINTMENT_TRANSITIONS[from as AppointmentStatus];
  return Array.isArray(allowed) && allowed.includes(to as AppointmentStatus);
}

/**
 * The shortest legal route from one status to another, as the hops to apply.
 *
 * Derived from APPOINTMENT_TRANSITIONS by breadth-first search rather than
 * written out as a second table. A hand-written route table is a second source
 * of truth, and it disagrees with the first the moment someone edits a
 * transition — which is the whole failure class this module exists to prevent.
 *
 * Returns the hops EXCLUDING `from` and INCLUDING `to`; [] when already there,
 * and null when there is no legal route at all. Because cancelled and
 * completed are terminal, no returned path can ever pass THROUGH them.
 *
 * Entries are visited in declaration order, so the result is deterministic:
 * scheduled → completed is ['checked_in', 'completed'], not the longer route
 * that goes via confirmed.
 */
export function statusPath(from: string, to: AppointmentStatus): AppointmentStatus[] | null {
  if (!(from in APPOINTMENT_TRANSITIONS)) return null;
  if (from === to) return [];

  const queue: AppointmentStatus[][] = [[from as AppointmentStatus]];
  const seen = new Set<string>([from]);

  while (queue.length) {
    const route = queue.shift()!;
    const tail = route[route.length - 1];

    for (const next of APPOINTMENT_TRANSITIONS[tail] ?? []) {
      if (seen.has(next)) continue;
      if (next === to) return [...route.slice(1), next];
      seen.add(next);
      queue.push([...route, next]);
    }
  }

  return null;
}

export interface AppointmentStatusPatch {
  status: AppointmentStatus;
  confirmedAt?: Date | null;
  checkedInAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
  cancellationReason?: string | null;
}

export interface StatusChangeInput {
  from: string;
  to: AppointmentStatus;
  now: Date;
  actorId: string;
  reason?: string | null;
  existing?: {
    confirmedAt?: Date | null;
    checkedInAt?: Date | null;
  };
}

/**
 * Status and its timestamps, together.
 *
 * Timestamps are backfilled where the sequence would otherwise have a hole: a
 * walk-in is never confirmed, and a patient sometimes goes straight from the
 * chair to completed. Leaving those null makes the timeline unreadable and
 * breaks any duration report built on the pair.
 *
 * NOTE: `in_progress` has no timestamp column of its own. Do not invent one —
 * the linked visit's createdAt is the record of when work started.
 *
 * Callers should short-circuit when the status is unchanged: a self
 * transition is rejected here, so a double-click cannot restamp a timestamp.
 *
 * NOTE: no_show has no column either. It sets the status only; who marked it
 * and when belongs in audit_logs. Overloading cancelledAt/cancelledBy would
 * corrupt every cancellation report.
 */
export function applyStatusChange(input: StatusChangeInput): AppointmentStatusPatch {
  const { from, to, now, actorId, reason, existing } = input;

  if (!canTransition(from, to)) {
    throw new Error(`An appointment that is ${from} cannot become ${to}.`);
  }

  const patch: AppointmentStatusPatch = { status: to };

  switch (to) {
    case APPOINTMENT_STATUS.CONFIRMED:
      // Self-transitions are rejected above, so this is always a real change.
      // The fallback covers re-confirming after an unconfirm.
      patch.confirmedAt = existing?.confirmedAt ?? now;
      break;

    case APPOINTMENT_STATUS.CHECKED_IN:
      patch.checkedInAt = now;
      // A walk-in never passed through confirmation.
      patch.confirmedAt = existing?.confirmedAt ?? now;
      break;

    case APPOINTMENT_STATUS.COMPLETED:
      patch.completedAt = now;
      patch.checkedInAt = existing?.checkedInAt ?? now;
      patch.confirmedAt = existing?.confirmedAt ?? now;
      break;

    case APPOINTMENT_STATUS.CANCELLED:
      patch.cancelledAt = now;
      patch.cancelledBy = actorId;
      patch.cancellationReason = reason ?? null;
      break;

    case APPOINTMENT_STATUS.SCHEDULED:
      // Un-confirming, or correcting a no-show back to a live booking.
      patch.confirmedAt = null;
      patch.checkedInAt = null;
      break;

    case APPOINTMENT_STATUS.NO_SHOW:
    case APPOINTMENT_STATUS.IN_PROGRESS:
      // Status only — see the note above.
      break;

    default:
      break;
  }

  return patch;
}

/**
 * The same patch, but for a status several legal hops away.
 *
 * applyStatusChange() is the single-hop primitive and still THROWS on an
 * illegal transition, which is right when a human is pressing a status button.
 * This is for callers reacting to a clinical event instead: a dentist
 * completing a visit must not get an error because the front desk never
 * pressed "check in". Feed it a path from statusPath() and every hop is legal
 * by construction, so this never throws.
 *
 * Each hop is given the ACCUMULATED timestamps rather than the row's original
 * ones, so the second hop sees the checkedInAt the first one stamped instead
 * of stamping a fresh one over it.
 *
 * The accumulation tests `in` rather than using ??, because the `scheduled`
 * case deliberately writes null to clear a timestamp and ?? would swallow
 * that, silently resurrecting the value the hop meant to erase.
 */
export function applyStatusPath(
  input: Omit<StatusChangeInput, 'to'> & { path: readonly AppointmentStatus[] }
): AppointmentStatusPatch {
  const { from, path, ...rest } = input;

  let at = from;
  let existing = { ...input.existing };
  let patch: AppointmentStatusPatch = { status: from as AppointmentStatus };

  for (const to of path) {
    const step = applyStatusChange({ ...rest, from: at, to, existing });
    patch = { ...patch, ...step };

    existing = {
      confirmedAt: 'confirmedAt' in step ? step.confirmedAt : existing.confirmedAt,
      checkedInAt: 'checkedInAt' in step ? step.checkedInAt : existing.checkedInAt,
    };
    at = to;
  }

  return patch;
}

/**
 * Rescheduling resets the appointment to unconfirmed AND clears
 * reminderEmailSentAt.
 *
 * That last part matters: without it the guard "already reminded" suppresses
 * the reminder for the NEW time, and the patient is only ever told about a
 * slot that no longer exists.
 */
export interface ReschedulePatch {
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  confirmedAt: null;
  reminderEmailSentAt: null;
  chairId?: string | null;
  dentistId?: string;
}

export function applyReschedule(input: {
  startAt: Date;
  endAt: Date;
  chairId?: string | null;
  dentistId?: string;
}): ReschedulePatch {
  return {
    startAt: input.startAt,
    endAt: input.endAt,
    status: APPOINTMENT_STATUS.SCHEDULED,
    confirmedAt: null,
    reminderEmailSentAt: null,
    ...(input.chairId !== undefined ? { chairId: input.chairId } : {}),
    ...(input.dentistId !== undefined ? { dentistId: input.dentistId } : {}),
  };
}

/** Appointments still waiting to be seen, for the front-desk queue. */
export const WAITING_STATUSES: readonly AppointmentStatus[] = [
  APPOINTMENT_STATUS.CHECKED_IN,
];

/** Statuses that mean the appointment is over, one way or another. */
export const CLOSED_STATUSES: readonly AppointmentStatus[] = [
  APPOINTMENT_STATUS.COMPLETED,
  APPOINTMENT_STATUS.CANCELLED,
  APPOINTMENT_STATUS.NO_SHOW,
];

/** Minutes a checked-in patient has been waiting. */
export function waitingMinutes(checkedInAt: Date | null | undefined, now: Date): number | null {
  if (!checkedInAt) return null;
  return Math.max(0, Math.round((now.getTime() - checkedInAt.getTime()) / 60_000));
}

/** Escalates the wait time in the queue so a long wait is visible. */
export function waitSeverity(minutes: number | null): 'none' | 'warn' | 'urgent' {
  if (minutes === null) return 'none';
  if (minutes >= 30) return 'urgent';
  if (minutes >= 15) return 'warn';
  return 'none';
}
