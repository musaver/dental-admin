import { db } from '@/lib/db';
import { appointments, procedures, recalls, visitProcedures, visits } from '@/lib/schema';
import { RECALL_STATUS, VISIT_PROCEDURE_STATUS } from '@/lib/enums';
import { addMonthsClamped, clinicNow } from '@/lib/datetime';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * Recall generation.
 *
 * When a visit completes, any procedure carrying a defaultRecallMonths creates
 * the patient's next reminder. `recalls.recallType` has no default in the
 * schema and needs a vocabulary, so it reuses the procedure's `category`
 * verbatim: both are varchar(30), the mapping is exact, and the ten seeded
 * categories become a self-documenting recall taxonomy.
 */

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * How close two recalls of the same type must be before the second is treated
 * as a duplicate.
 *
 * Ortho Adjustment is seeded with defaultRecallMonths = 1 and is performed at
 * nearly every visit, so without this the patient accumulates a fresh recall
 * every few weeks and the worklist becomes noise.
 */
const DEDUPE_WINDOW_DAYS = 30;

export interface GeneratedRecall {
  id: string;
  recallType: string;
  dueDate: Date;
}

/**
 * Create recalls for a completed visit.
 *
 * Idempotent: re-completing a visit does not duplicate its recalls, and a
 * pending recall of the same type already due within the window is left alone.
 * Safe to call from both the visit route and a repair job.
 */
export async function generateRecallsForVisit(
  tx: Executor,
  visitId: string,
  actorId: string
): Promise<GeneratedRecall[]> {
  const [visit] = await tx
    .select({
      id: visits.id,
      patientId: visits.patientId,
      branchId: visits.branchId,
      visitDate: visits.visitDate,
    })
    .from(visits)
    .where(eq(visits.id, visitId))
    .limit(1);

  if (!visit) return [];

  const performed = await tx
    .select({
      procedureId: visitProcedures.procedureId,
      category: procedures.category,
      defaultRecallMonths: procedures.defaultRecallMonths,
    })
    .from(visitProcedures)
    .innerJoin(procedures, eq(visitProcedures.procedureId, procedures.id))
    .where(
      and(
        eq(visitProcedures.visitId, visitId),
        eq(visitProcedures.status, VISIT_PROCEDURE_STATUS.COMPLETED)
      )
    );

  const wanted = performed.filter((p) => p.defaultRecallMonths && p.defaultRecallMonths > 0);
  if (!wanted.length) return [];

  // Already generated from this visit? Then this is a re-completion.
  const existingFromVisit = await tx
    .select({ recallType: recalls.recallType })
    .from(recalls)
    .where(eq(recalls.sourceVisitId, visitId));
  const alreadyFromVisit = new Set(existingFromVisit.map((r) => r.recallType));

  const visitDate = visit.visitDate ?? clinicNow();
  const created: GeneratedRecall[] = [];
  const seen = new Set<string>();

  for (const procedure of wanted) {
    const recallType = procedure.category;
    if (alreadyFromVisit.has(recallType) || seen.has(recallType)) continue;
    seen.add(recallType);

    const dueDate = addMonthsClamped(visitDate, procedure.defaultRecallMonths!);

    // A pending recall of this type already falling near the same date is the
    // same clinical intention; do not stack another on top.
    const windowStart = new Date(dueDate.getTime() - DEDUPE_WINDOW_DAYS * 86_400_000);
    const windowEnd = new Date(dueDate.getTime() + DEDUPE_WINDOW_DAYS * 86_400_000);

    const nearby = await tx
      .select({ id: recalls.id })
      .from(recalls)
      .where(
        and(
          eq(recalls.patientId, visit.patientId),
          eq(recalls.recallType, recallType),
          eq(recalls.status, RECALL_STATUS.PENDING),
          gte(recalls.dueDate, windowStart),
          lte(recalls.dueDate, windowEnd)
        )
      )
      .limit(1);

    if (nearby.length) continue;

    const now = clinicNow();
    const row = {
      id: uuidv4(),
      patientId: visit.patientId,
      branchId: visit.branchId,
      recallType,
      dueDate,
      intervalMonths: procedure.defaultRecallMonths!,
      status: RECALL_STATUS.PENDING,
      appointmentId: null,
      sourceVisitId: visitId,
      notes: null,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    };

    await tx.insert(recalls).values(row);
    created.push({ id: row.id, recallType, dueDate });
  }

  return created;
}

/**
 * Link a recall to the appointment booked from it.
 *
 * Both sides must be written together: appointments.recallId and
 * recalls.appointmentId point at each other with nothing enforcing agreement.
 */
export async function linkRecallToAppointment(
  tx: Executor,
  recallId: string,
  appointmentId: string
): Promise<void> {
  const now = clinicNow();

  await tx
    .update(recalls)
    .set({ appointmentId, status: RECALL_STATUS.BOOKED, updatedAt: now })
    .where(eq(recalls.id, recallId));

  await tx
    .update(appointments)
    .set({ recallId, updatedAt: now })
    .where(eq(appointments.id, appointmentId));
}

/** Return a recall to the worklist when its appointment is cancelled. */
export async function unlinkRecallFromAppointment(
  tx: Executor,
  recallId: string,
  appointmentId: string
): Promise<void> {
  const now = clinicNow();

  await tx
    .update(recalls)
    .set({ appointmentId: null, status: RECALL_STATUS.PENDING, updatedAt: now })
    .where(eq(recalls.id, recallId));

  await tx
    .update(appointments)
    .set({ recallId: null, updatedAt: now })
    .where(eq(appointments.id, appointmentId));
}

/**
 * Is a pending recall overdue?
 *
 * Derived rather than stored. An 'overdue' status would need a nightly job to
 * maintain and would be a second source of truth that could disagree with the
 * due date it came from.
 */
export function isOverdue(recall: { status: string; dueDate: Date }, asOf = clinicNow()): boolean {
  return recall.status === RECALL_STATUS.PENDING && recall.dueDate <= asOf;
}

/** Statuses that still need someone to act. */
export const OPEN_RECALL_STATUSES: readonly string[] = [
  RECALL_STATUS.PENDING,
  RECALL_STATUS.CONTACTED,
];
