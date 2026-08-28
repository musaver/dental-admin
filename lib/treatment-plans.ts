import { TREATMENT_PLAN_STATUS, type TreatmentPlanStatus } from './enums.ts';

/**
 * Treatment plan lifecycle — pure, so it is unit tested.
 *
 * The schema carries the status as a string AND parallel timestamps
 * (proposedAt, acceptedAt). Neither derives the other, so both must be written
 * together or the record disagrees with itself. applyStatusChange() returns
 * the whole patch so a caller cannot set one and forget the other.
 */

/**
 * draft → proposed → accepted → in_progress → completed
 *
 * A plan can be cancelled from anywhere except a terminal state, and a
 * proposed plan can be rejected. Going back to draft from proposed is allowed
 * because a quote often needs reworking before the patient decides.
 */
export const PLAN_TRANSITIONS: Record<TreatmentPlanStatus, TreatmentPlanStatus[]> = {
  [TREATMENT_PLAN_STATUS.DRAFT]: [
    TREATMENT_PLAN_STATUS.PROPOSED,
    TREATMENT_PLAN_STATUS.CANCELLED,
  ],
  [TREATMENT_PLAN_STATUS.PROPOSED]: [
    TREATMENT_PLAN_STATUS.ACCEPTED,
    TREATMENT_PLAN_STATUS.REJECTED,
    TREATMENT_PLAN_STATUS.DRAFT,
    TREATMENT_PLAN_STATUS.CANCELLED,
  ],
  [TREATMENT_PLAN_STATUS.ACCEPTED]: [
    TREATMENT_PLAN_STATUS.IN_PROGRESS,
    TREATMENT_PLAN_STATUS.COMPLETED,
    TREATMENT_PLAN_STATUS.CANCELLED,
  ],
  [TREATMENT_PLAN_STATUS.IN_PROGRESS]: [
    TREATMENT_PLAN_STATUS.COMPLETED,
    TREATMENT_PLAN_STATUS.CANCELLED,
  ],
  // Terminal.
  [TREATMENT_PLAN_STATUS.COMPLETED]: [],
  [TREATMENT_PLAN_STATUS.REJECTED]: [],
  [TREATMENT_PLAN_STATUS.CANCELLED]: [],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = PLAN_TRANSITIONS[from as TreatmentPlanStatus];
  return Array.isArray(allowed) && allowed.includes(to as TreatmentPlanStatus);
}

export interface PlanStatusPatch {
  status: TreatmentPlanStatus;
  proposedAt?: Date | null;
  acceptedAt?: Date | null;
  cancelReason?: string | null;
  acceptedNote?: string | null;
}

/**
 * Status and its timestamps, together.
 *
 * proposedAt is backfilled on acceptance if it is missing — a plan accepted
 * straight from draft still needs a proposal date, or the acceptance-rate
 * report has nothing to measure against.
 */
export function applyPlanStatusChange(options: {
  from: string;
  to: TreatmentPlanStatus;
  now: Date;
  existingProposedAt?: Date | null;
  reason?: string | null;
  note?: string | null;
}): PlanStatusPatch {
  const { from, to, now, existingProposedAt, reason, note } = options;

  if (!canTransition(from, to)) {
    throw new Error(`A ${from} plan cannot become ${to}.`);
  }

  const patch: PlanStatusPatch = { status: to };

  switch (to) {
    case TREATMENT_PLAN_STATUS.PROPOSED:
      patch.proposedAt = existingProposedAt ?? now;
      break;

    case TREATMENT_PLAN_STATUS.ACCEPTED:
      patch.acceptedAt = now;
      patch.proposedAt = existingProposedAt ?? now;
      patch.acceptedNote = note ?? null;
      break;

    case TREATMENT_PLAN_STATUS.CANCELLED:
    case TREATMENT_PLAN_STATUS.REJECTED:
      patch.cancelReason = reason ?? null;
      break;

    case TREATMENT_PLAN_STATUS.DRAFT:
      // Sent back for reworking: the earlier proposal no longer stands.
      patch.proposedAt = null;
      patch.acceptedAt = null;
      break;

    default:
      break;
  }

  return patch;
}

/**
 * Is the plan's pricing still editable?
 *
 * Once a patient has accepted a quote, changing the numbers behind it is not
 * an edit — it is a different quote. Amendments belong in a new plan, so the
 * accepted figure stays auditable against what was actually agreed.
 */
export function isPricingLocked(status: string): boolean {
  return (
    status === TREATMENT_PLAN_STATUS.ACCEPTED ||
    status === TREATMENT_PLAN_STATUS.IN_PROGRESS ||
    status === TREATMENT_PLAN_STATUS.COMPLETED
  );
}

/** Statuses that count as a live commitment, for reporting. */
export const ACTIVE_PLAN_STATUSES: readonly TreatmentPlanStatus[] = [
  TREATMENT_PLAN_STATUS.ACCEPTED,
  TREATMENT_PLAN_STATUS.IN_PROGRESS,
];

/** Was this plan ever put to the patient? Denominator of acceptance rate. */
export function wasProposed(plan: { proposedAt?: Date | null; status: string }): boolean {
  return (
    plan.proposedAt != null ||
    plan.status !== TREATMENT_PLAN_STATUS.DRAFT
  );
}
