import { db } from '@/lib/db';
import {
  appointments,
  invoiceItems,
  invoices,
  patientConditions,
  patients,
  payments,
  treatmentPlanItems,
  treatmentPlans,
} from '@/lib/schema';
import {
  computeInvoiceTotals,
  computeItemNet,
  computePlanTotals,
  recomputeInvoiceStatus,
  sumPayments,
} from '@/lib/money';
import { PAYMENT_TYPE, TREATMENT_PLAN_ITEM_STATUS } from '@/lib/enums';
import { and, eq, sql } from 'drizzle-orm';

/**
 * Keepers for the seven denormalised fields.
 *
 * The database enforces none of them — no triggers, no generated columns, no
 * foreign keys. Each one is a cached rollup that drifts the moment a single
 * write path forgets to update it, and drift here is invisible until someone
 * notices the money is wrong.
 *
 *   patients.hasAlerts               ← patient_conditions.isAlert
 *   invoices.paidAmount              ← Σ signed payments
 *   invoices.status                  ← amounts, preserving waived
 *   treatment_plans.totalAmount      ← items
 *   treatment_plans.discountTotal    ← items
 *   treatment_plans.netAmount        ← items
 *   treatment_plan_items.netAmount   ← its own price and discount
 *
 * RULE: never UPDATE one of those columns directly. Call the function here,
 * from inside the same transaction as the change that caused it.
 *
 * Every function takes an optional `tx` so it can join a surrounding
 * transaction — recomputing outside the transaction that inserted the payment
 * would leave the rollup describing a state that got rolled back.
 */

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ── patients.hasAlerts ──────────────────────────────────────────────── */

/**
 * Mirror of "this patient has at least one active alert condition".
 *
 * Kept denormalised so a patient LIST can show the red flag without joining
 * patient_conditions for every row. The detail page should still derive from
 * the conditions themselves.
 */
export async function recomputeHasAlerts(
  patientId: string,
  tx: Executor = db
): Promise<boolean> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(patientConditions)
    .where(
      and(
        eq(patientConditions.patientId, patientId),
        eq(patientConditions.isAlert, true),
        eq(patientConditions.status, 'active')
      )
    );

  const hasAlerts = Number(row?.n ?? 0) > 0;

  await tx
    .update(patients)
    .set({ hasAlerts, updatedAt: new Date() })
    .where(eq(patients.id, patientId));

  return hasAlerts;
}

/* ── invoices.paidAmount + status ────────────────────────────────────── */

export interface InvoiceRecomputeResult {
  paidAmount: number;
  status: string;
  balance: number;
}

/**
 * Re-derive an invoice's paidAmount and status from its payment rows.
 *
 * Must be called after EVERY payment insert, allocation, refund or void.
 * Sums through signedAmount so a refund subtracts rather than adds.
 */
export async function recomputeInvoice(
  invoiceId: string,
  tx: Executor = db
): Promise<InvoiceRecomputeResult | null> {
  const [invoice] = await tx
    .select({
      id: invoices.id,
      totalAmount: invoices.totalAmount,
      status: invoices.status,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!invoice) return null;

  const rows = await tx
    .select({ type: payments.type, amount: payments.amount })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId));

  const paidAmount = sumPayments(rows);
  const hasRefunds = rows.some((r) => r.type === PAYMENT_TYPE.REFUND);

  const status = recomputeInvoiceStatus({
    totalAmount: invoice.totalAmount,
    paidAmount,
    currentStatus: invoice.status,
    hasRefunds,
  });

  await tx
    .update(invoices)
    .set({ paidAmount, status, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  return { paidAmount, status, balance: invoice.totalAmount - paidAmount };
}

/**
 * Re-derive an invoice's subtotal, discountTotal and totalAmount from its
 * lines, then its payment-driven fields. Call after adding or removing a line.
 */
export async function recomputeInvoiceTotals(
  invoiceId: string,
  tx: Executor = db
): Promise<InvoiceRecomputeResult | null> {
  const lines = await tx
    .select({
      quantity: invoiceItems.quantity,
      unitPrice: invoiceItems.unitPrice,
      discountAmount: invoiceItems.discountAmount,
      itemType: invoiceItems.itemType,
      amount: invoiceItems.amount,
    })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId));

  const totals = computeInvoiceTotals(
    lines.map((l) => ({
      quantity: l.quantity ?? 1,
      unitPrice: l.unitPrice,
      discountAmount: l.discountAmount ?? 0,
      itemType: l.itemType,
      amount: l.amount,
    }))
  );

  await tx
    .update(invoices)
    .set({ ...totals, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  // Status depends on the new total, so payments must be re-evaluated too.
  return recomputeInvoice(invoiceId, tx);
}

/* ── treatment_plan_items.netAmount ──────────────────────────────────── */

/** The seventh denormalised field, and the one most easily overlooked. */
export async function recomputePlanItemNet(
  itemId: string,
  tx: Executor = db
): Promise<number | null> {
  const [item] = await tx
    .select({
      quantity: treatmentPlanItems.quantity,
      unitPrice: treatmentPlanItems.unitPrice,
      discountType: treatmentPlanItems.discountType,
      discountValue: treatmentPlanItems.discountValue,
    })
    .from(treatmentPlanItems)
    .where(eq(treatmentPlanItems.id, itemId))
    .limit(1);

  if (!item) return null;

  const netAmount = computeItemNet(item);

  await tx
    .update(treatmentPlanItems)
    .set({ netAmount, updatedAt: new Date() })
    .where(eq(treatmentPlanItems.id, itemId));

  return netAmount;
}

/* ── treatment_plans money rollup ────────────────────────────────────── */

export interface PlanTotals {
  totalAmount: number;
  discountTotal: number;
  netAmount: number;
}

/**
 * Re-derive a plan's three money columns from its items.
 * Invariant: netAmount === totalAmount − discountTotal.
 *
 * Cancelled items are excluded: they are not part of what the patient is being
 * quoted, so leaving them in would overstate every accepted-value report.
 */
export async function recomputePlanTotals(
  planId: string,
  tx: Executor = db
): Promise<PlanTotals> {
  const items = await tx
    .select({
      quantity: treatmentPlanItems.quantity,
      unitPrice: treatmentPlanItems.unitPrice,
      discountType: treatmentPlanItems.discountType,
      discountValue: treatmentPlanItems.discountValue,
      status: treatmentPlanItems.status,
    })
    .from(treatmentPlanItems)
    .where(eq(treatmentPlanItems.treatmentPlanId, planId));

  const totals = computePlanTotals(items);

  await tx
    .update(treatmentPlans)
    .set({ ...totals, updatedAt: new Date() })
    .where(eq(treatmentPlans.id, planId));

  return totals;
}

/**
 * Recompute every item's net, then the plan rollup.
 * Use after a bulk edit, or when repairing drift.
 */
export async function recomputePlanDeep(planId: string, tx: Executor = db): Promise<PlanTotals> {
  const items = await tx
    .select({ id: treatmentPlanItems.id })
    .from(treatmentPlanItems)
    .where(eq(treatmentPlanItems.treatmentPlanId, planId));

  for (const item of items) {
    await recomputePlanItemNet(item.id, tx);
  }

  return recomputePlanTotals(planId, tx);
}

/* ── Bidirectional pointer pairs ─────────────────────────────────────── */

/**
 * Five pairs point at each other with nothing enforcing agreement:
 *
 *   leads.convertedPatientId          ↔ patients.leadId
 *   appointments.treatmentPlanItemId  ↔ treatment_plan_items.appointmentId
 *   appointments.recallId             ↔ recalls.appointmentId
 *   tooth_conditions.treatmentPlanItemId ↔ treatment_plan_items.toothConditionId
 *   treatment_plan_items.visitProcedureId ↔ visit_procedures.treatmentPlanItemId
 *
 * Both sides must be written inside ONE transaction. Half a pair is
 * permanently wrong and invisible — scripts/check-invariants.mjs looks for it.
 */

/** Link an appointment to the plan item it will deliver. */
export async function linkAppointmentToPlanItem(
  tx: Executor,
  appointmentId: string,
  planItemId: string
): Promise<void> {
  const now = new Date();

  await tx
    .update(appointments)
    .set({ treatmentPlanItemId: planItemId, updatedAt: now })
    .where(eq(appointments.id, appointmentId));

  await tx
    .update(treatmentPlanItems)
    .set({
      appointmentId,
      status: TREATMENT_PLAN_ITEM_STATUS.SCHEDULED,
      updatedAt: now,
    })
    .where(eq(treatmentPlanItems.id, planItemId));
}

/** Undo the above, returning the item to the unscheduled pool. */
export async function unlinkAppointmentFromPlanItem(
  tx: Executor,
  appointmentId: string,
  planItemId: string
): Promise<void> {
  const now = new Date();

  await tx
    .update(appointments)
    .set({ treatmentPlanItemId: null, updatedAt: now })
    .where(eq(appointments.id, appointmentId));

  await tx
    .update(treatmentPlanItems)
    .set({
      appointmentId: null,
      status: TREATMENT_PLAN_ITEM_STATUS.PENDING,
      updatedAt: now,
    })
    .where(eq(treatmentPlanItems.id, planItemId));
}
