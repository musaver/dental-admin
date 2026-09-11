import { db } from '@/lib/db';
import {
  branches,
  invoiceItems,
  invoices,
  patients,
  procedures,
  treatmentPlanItems,
  visitProcedures,
} from '@/lib/schema';
import {
  assertInvoiceTotals,
  computeDiscountAmount,
  computeInvoiceTotals,
  computeLineAmount,
  type InvoiceLine,
} from '@/lib/money';
import { INVOICE_ITEM_TYPE, INVOICE_STATUS } from '@/lib/enums';
import { toothCount } from '@/lib/odontogram';
import { clinicNow } from '@/lib/datetime';
import {
  invoiceNumberPrefix,
  invoicePeriod,
  nextInvoiceNumber,
} from '@/lib/invoice-number';
import { and, desc, eq, inArray, isNotNull, like } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * Invoice construction.
 *
 * Replaces lib/fee.ts from the education app, which was written against the
 * fee_invoices tables that no longer exist.
 */

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** How many times to retry when two invoices race for the same number. */
export const INVOICE_NUMBER_RETRIES = 5;

/**
 * Allocate the next invoice number for a branch-month.
 *
 * MUST run inside the insert transaction, and the caller must retry on errno
 * 1062: two invoices raised at the same instant read the same highest number.
 * The unique index is the guarantee; this only provides liveness.
 */
export async function allocateInvoiceNumber(
  tx: Executor,
  branchId: string,
  issuedAt: Date
): Promise<string> {
  const [branch] = await tx
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);

  if (!branch) throw new Error(`Branch ${branchId} does not exist.`);

  const period = invoicePeriod(issuedAt);
  const prefix = invoiceNumberPrefix(branch.code, period);

  const [highest] = await tx
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(like(invoices.invoiceNumber, `${prefix}%`))
    .orderBy(desc(invoices.invoiceNumber))
    .limit(1);

  return nextInvoiceNumber(branch.code, issuedAt, highest?.invoiceNumber);
}

export interface DraftLine {
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  itemType: string;
  teeth?: string | null;
  procedureId?: string | null;
  visitProcedureId?: string | null;
  treatmentPlanItemId?: string | null;
}

/**
 * Lines for the work actually performed at a visit.
 *
 * Skips any visit_procedure already invoiced, so running this twice cannot
 * bill the same treatment twice.
 *
 * QUANTITY: visit_procedures.price is PER UNIT and the table has no quantity
 * column, so for a per-tooth procedure the tooth count carries it. Reading
 * price as a line total instead would under-bill a three-tooth root canal by
 * two thirds.
 */
export async function buildLinesFromVisit(
  tx: Executor,
  visitId: string
): Promise<DraftLine[]> {
  const performed = await tx
    .select({
      id: visitProcedures.id,
      procedureId: visitProcedures.procedureId,
      teeth: visitProcedures.teeth,
      price: visitProcedures.price,
      status: visitProcedures.status,
      treatmentPlanItemId: visitProcedures.treatmentPlanItemId,
      name: procedures.name,
      isPerTooth: procedures.isPerTooth,
    })
    .from(visitProcedures)
    .leftJoin(procedures, eq(visitProcedures.procedureId, procedures.id))
    .where(eq(visitProcedures.visitId, visitId));

  const alreadyInvoiced = new Set(
    (
      await tx
        .select({ visitProcedureId: invoiceItems.visitProcedureId })
        .from(invoiceItems)
        .where(isNotNull(invoiceItems.visitProcedureId))
    ).map((r) => r.visitProcedureId)
  );

  // The same work, billed from the other side. buildLinesFromTreatmentPlan()
  // writes visitProcedureId: null, so a plan invoice is invisible to the set
  // above — invoice an accepted plan and then invoice the visit that performed
  // it, and the patient is charged twice. (The reverse order is already safe:
  // lines built from a visit carry BOTH pointers.)
  //
  // The seed enforces this by hand — scripts/seed/06-billing.mjs: "a plan
  // invoice only carries items that have NOT been through a chair yet" — which
  // made the demo data look clean while production was not.
  const planItemIds = performed
    .map((p) => p.treatmentPlanItemId)
    .filter((id): id is string => Boolean(id));

  const alreadyInvoicedPlanItems = new Set(
    planItemIds.length
      ? (
          await tx
            .select({ treatmentPlanItemId: invoiceItems.treatmentPlanItemId })
            .from(invoiceItems)
            .where(inArray(invoiceItems.treatmentPlanItemId, planItemIds))
        ).map((r) => r.treatmentPlanItemId)
      : []
  );

  return performed
    .filter(
      (p) =>
        p.status !== 'cancelled' &&
        !alreadyInvoiced.has(p.id) &&
        !(p.treatmentPlanItemId && alreadyInvoicedPlanItems.has(p.treatmentPlanItemId))
    )
    .map((p) => {
      const quantity = p.isPerTooth && p.teeth ? toothCount(p.teeth) : 1;
      return {
        description: p.name ?? 'Procedure',
        quantity,
        unitPrice: p.price,
        discountAmount: 0,
        itemType: INVOICE_ITEM_TYPE.PROCEDURE,
        teeth: p.teeth,
        procedureId: p.procedureId,
        visitProcedureId: p.id,
        treatmentPlanItemId: p.treatmentPlanItemId,
      };
    });
}

/**
 * Lines for an accepted treatment plan.
 *
 * The plan stores a polymorphic discountType + discountValue, while
 * invoice_items stores a flat absolute discountAmount — so the percentage is
 * RESOLVED here. The plan's own netAmount is cross-checked and a divergence
 * logged: it means the price moved since the quote was written.
 */
export async function buildLinesFromTreatmentPlan(
  tx: Executor,
  planId: string,
  itemIds?: string[]
): Promise<DraftLine[]> {
  const items = await tx
    .select({
      id: treatmentPlanItems.id,
      procedureId: treatmentPlanItems.procedureId,
      teeth: treatmentPlanItems.teeth,
      unitPrice: treatmentPlanItems.unitPrice,
      quantity: treatmentPlanItems.quantity,
      discountType: treatmentPlanItems.discountType,
      discountValue: treatmentPlanItems.discountValue,
      netAmount: treatmentPlanItems.netAmount,
      status: treatmentPlanItems.status,
      name: procedures.name,
    })
    .from(treatmentPlanItems)
    .leftJoin(procedures, eq(treatmentPlanItems.procedureId, procedures.id))
    .where(eq(treatmentPlanItems.treatmentPlanId, planId));

  const alreadyInvoiced = new Set(
    (
      await tx
        .select({ treatmentPlanItemId: invoiceItems.treatmentPlanItemId })
        .from(invoiceItems)
        .where(isNotNull(invoiceItems.treatmentPlanItemId))
    ).map((r) => r.treatmentPlanItemId)
  );

  return items
    .filter((item) => {
      if (item.status === 'cancelled') return false;
      if (alreadyInvoiced.has(item.id)) return false;
      if (itemIds && !itemIds.includes(item.id)) return false;
      return true;
    })
    .map((item) => {
      const quantity = item.quantity ?? 1;
      const gross = quantity * item.unitPrice;
      const discountAmount = computeDiscountAmount(gross, {
        discountType: item.discountType,
        value: item.discountValue,
      });

      if (gross - discountAmount !== item.netAmount) {
        console.warn(
          `Treatment plan item ${item.id}: stored netAmount ${item.netAmount} differs from ` +
            `the recomputed ${gross - discountAmount}. Invoicing the recomputed value.`
        );
      }

      return {
        description: item.name ?? 'Procedure',
        quantity,
        unitPrice: item.unitPrice,
        discountAmount,
        itemType: INVOICE_ITEM_TYPE.PROCEDURE,
        teeth: item.teeth,
        procedureId: item.procedureId,
        visitProcedureId: null,
        treatmentPlanItemId: item.id,
      };
    });
}

/**
 * The patient's standing discount, as a visible line.
 *
 * Rendering it as a line rather than folding it into the header keeps the
 * printed invoice self-explanatory, and the totals rule in lib/money.ts stops
 * it double-counting. Skipped when any line already carries its own discount,
 * so the two never stack silently.
 */
export function buildPatientDiscountLine(
  lines: readonly DraftLine[],
  discountPercent: number
): DraftLine | null {
  if (!discountPercent || discountPercent <= 0) return null;
  if (lines.some((l) => l.discountAmount > 0)) return null;

  const subtotal = lines
    .filter((l) => l.itemType !== INVOICE_ITEM_TYPE.DISCOUNT)
    .reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  const amount = computeDiscountAmount(subtotal, {
    discountType: 'percentage',
    value: discountPercent,
  });
  if (amount <= 0) return null;

  return {
    description: `Patient discount (${discountPercent}%)`,
    quantity: 1,
    // A discount line is stored negative; computeInvoiceTotals expects that.
    unitPrice: -amount,
    discountAmount: 0,
    itemType: INVOICE_ITEM_TYPE.DISCOUNT,
  };
}

/** Turn draft lines into rows, computing each amount and the header totals. */
export function materialiseLines(invoiceId: string, drafts: readonly DraftLine[], now: Date) {
  const rows = drafts.map((draft) => {
    const amount =
      draft.itemType === INVOICE_ITEM_TYPE.DISCOUNT
        ? draft.quantity * draft.unitPrice // already negative
        : computeLineAmount(draft);

    return {
      id: uuidv4(),
      invoiceId,
      procedureId: draft.procedureId ?? null,
      visitProcedureId: draft.visitProcedureId ?? null,
      treatmentPlanItemId: draft.treatmentPlanItemId ?? null,
      description: draft.description.slice(0, 255),
      teeth: draft.teeth ?? null,
      quantity: draft.quantity,
      unitPrice: draft.unitPrice,
      discountAmount: draft.discountAmount,
      amount,
      itemType: draft.itemType,
      createdAt: now,
    };
  });

  const totals = computeInvoiceTotals(rows as unknown as InvoiceLine[]);
  // Refuses to write an invoice whose header disagrees with its lines.
  assertInvoiceTotals(rows as unknown as InvoiceLine[], totals);

  return { rows, totals };
}

export interface CreateInvoiceInput {
  patientId: string;
  branchId: string;
  visitId?: string | null;
  treatmentPlanId?: string | null;
  dueDate?: Date | null;
  notes?: string | null;
  createdBy: string;
  lines: DraftLine[];
  /** Adds the patient's standing discount as a line. */
  applyPatientDiscount?: boolean;
}

/**
 * Build and insert an invoice with its lines.
 * Call inside a transaction; retry the whole thing on a duplicate number.
 */
export async function createInvoice(tx: Executor, input: CreateInvoiceInput) {
  const now = clinicNow();

  let lines = [...input.lines];

  if (input.applyPatientDiscount) {
    const [patient] = await tx
      .select({ defaultDiscountPercent: patients.defaultDiscountPercent })
      .from(patients)
      .where(eq(patients.id, input.patientId))
      .limit(1);

    const discountLine = buildPatientDiscountLine(
      lines,
      patient?.defaultDiscountPercent ?? 0
    );
    if (discountLine) lines.push(discountLine);
  }

  const invoiceId = uuidv4();
  const { rows, totals } = materialiseLines(invoiceId, lines, now);
  const invoiceNumber = await allocateInvoiceNumber(tx, input.branchId, now);

  const header = {
    id: invoiceId,
    invoiceNumber,
    patientId: input.patientId,
    branchId: input.branchId,
    visitId: input.visitId ?? null,
    treatmentPlanId: input.treatmentPlanId ?? null,
    issueDate: now,
    dueDate: input.dueDate ?? null,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    totalAmount: totals.totalAmount,
    paidAmount: 0,
    status: INVOICE_STATUS.UNPAID,
    notes: input.notes ?? null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  await tx.insert(invoices).values(header);
  if (rows.length) await tx.insert(invoiceItems).values(rows);

  return { invoice: header, items: rows, totals };
}

/** MySQL duplicate-key errno, which is how an invoice-number race surfaces. */
export function isDuplicateInvoiceNumber(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errno' in error &&
    (error as { errno?: number }).errno === 1062
  );
}
