import { db } from '@/lib/db';
import {
  appointments,
  invoiceItems,
  invoices,
  leads,
  patients,
  prescriptions,
  toothConditions,
  treatmentPlanItems,
  treatmentPlans,
  visits,
} from '@/lib/schema';
import { AuthError, AUTH_FAILURE, canAccessBranch } from '@/lib/branch-scope';
import type { StaffContext } from '@/lib/rbac';
import { and, eq, inArray } from 'drizzle-orm';

export { canAccessBranch };

/**
 * Branch-safe row loading.
 *
 * TWENTY-FOUR of the tables in this schema have no `branchId` column, and
 * roughly fifteen of those hold clinical data: patient_files, tooth_conditions,
 * visit_procedures, visit_diagnoses, prescriptions, prescription_items,
 * invoice_items, treatment_plan_items, patient_conditions, communication_logs,
 * lead_activities, task_comments, audit_logs, notifications, staff_time_off.
 *
 * Their branch is only knowable through a parent row. Combined with the total
 * absence of foreign keys, that makes
 *
 *     db.select().from(patientFiles).where(eq(patientFiles.id, id))
 *
 * a cross-branch data leak waiting to happen: a receptionist at one clinic can
 * fetch another clinic's radiograph by guessing an id.
 *
 * RULE: any route touching a table without `branchId` must start with a loader
 * from this file. The loader resolves the owning patient (or lead, or invoice)
 * and checks it against the caller's branch scope before anything is returned.
 *
 * Not-found and not-yours both return 404. A 403 would confirm the row exists,
 * turning the endpoint into an id-enumeration oracle.
 */

function notFound(what: string): never {
  throw new AuthError(AUTH_FAILURE.FORBIDDEN, 404, `${what} not found.`);
}

/** Branch predicate for a table that HAS a branchId column. */
export function branchFilter(
  ctx: StaffContext,
  column: Parameters<typeof eq>[0],
  branchIds: string[] | null
) {
  if (ctx.isHeadOffice && !branchIds) return undefined;
  const ids = branchIds ?? [ctx.branchId!];
  return ids.length === 1 ? eq(column, ids[0]) : inArray(column, ids);
}

/* ── Root entities (these DO carry branchId) ─────────────────────────── */

export async function loadPatient(ctx: StaffContext, patientId: string) {
  const [row] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!row || !canAccessBranch(ctx, row.branchId)) notFound('Patient');
  return row;
}

export async function loadLead(ctx: StaffContext, leadId: string) {
  const [row] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!row || !canAccessBranch(ctx, row.branchId)) notFound('Lead');
  return row;
}

export async function loadAppointment(ctx: StaffContext, appointmentId: string) {
  const [row] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  if (!row || !canAccessBranch(ctx, row.branchId)) notFound('Appointment');
  return row;
}

export async function loadVisit(ctx: StaffContext, visitId: string) {
  const [row] = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  if (!row || !canAccessBranch(ctx, row.branchId)) notFound('Visit');
  return row;
}

export async function loadTreatmentPlan(ctx: StaffContext, planId: string) {
  const [row] = await db
    .select()
    .from(treatmentPlans)
    .where(eq(treatmentPlans.id, planId))
    .limit(1);
  if (!row || !canAccessBranch(ctx, row.branchId)) notFound('Treatment plan');
  return row;
}

export async function loadInvoice(ctx: StaffContext, invoiceId: string) {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!row || !canAccessBranch(ctx, row.branchId)) notFound('Invoice');
  return row;
}

/* ── Child entities (NO branchId — reached through a parent) ─────────── */

/** tooth_conditions — the odontogram. Patient-scoped, no branch column. */
export async function loadToothCondition(ctx: StaffContext, id: string) {
  const [row] = await db
    .select()
    .from(toothConditions)
    .where(eq(toothConditions.id, id))
    .limit(1);
  if (!row) notFound('Tooth condition');
  await loadPatient(ctx, row.patientId);
  return row;
}

/** prescriptions — reachable only through its visit, which carries branchId. */
export async function loadPrescription(ctx: StaffContext, id: string) {
  const [row] = await db.select().from(prescriptions).where(eq(prescriptions.id, id)).limit(1);
  if (!row) notFound('Prescription');
  await loadPatient(ctx, row.patientId);
  return row;
}

/** treatment_plan_items — branch comes from the parent plan. */
export async function loadTreatmentPlanItem(ctx: StaffContext, id: string) {
  const [row] = await db
    .select()
    .from(treatmentPlanItems)
    .where(eq(treatmentPlanItems.id, id))
    .limit(1);
  if (!row) notFound('Treatment plan item');
  await loadTreatmentPlan(ctx, row.treatmentPlanId);
  return row;
}

/** invoice_items — branch comes from the parent invoice. */
export async function loadInvoiceItem(ctx: StaffContext, id: string) {
  const [row] = await db.select().from(invoiceItems).where(eq(invoiceItems.id, id)).limit(1);
  if (!row) notFound('Invoice item');
  await loadInvoice(ctx, row.invoiceId);
  return row;
}

/**
 * Assert a row already in hand belongs to a patient the caller may see.
 * For loops, where re-querying the patient per row would be wasteful.
 */
export async function assertPatientInScope(ctx: StaffContext, patientId: string) {
  await loadPatient(ctx, patientId);
}

/** Filter a set of patient ids down to those in scope, in one query. */
export async function patientsInScope(
  ctx: StaffContext,
  patientIds: readonly string[]
): Promise<Set<string>> {
  const ids = [...new Set(patientIds)].filter(Boolean);
  if (!ids.length) return new Set();

  const rows = await db
    .select({ id: patients.id, branchId: patients.branchId })
    .from(patients)
    .where(
      ctx.isHeadOffice
        ? inArray(patients.id, ids)
        : and(inArray(patients.id, ids), eq(patients.branchId, ctx.branchId!))
    );

  return new Set(rows.map((r) => r.id));
}
