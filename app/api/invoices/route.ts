import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { invoices, patients } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadPatient, loadTreatmentPlan, loadVisit } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  DISCOUNT_TYPE,
  INVOICE_ITEM_TYPE,
  valuesOf,
} from '@/lib/enums';
import {
  buildLinesFromTreatmentPlan,
  buildLinesFromVisit,
  createInvoice,
  isDuplicateCodeRedemption,
  isDuplicateInvoiceNumber,
  INVOICE_NUMBER_RETRIES,
  type DraftLine,
  type ExtraDiscountInput,
} from '@/lib/invoices';
import {
  DISCOUNT_CODE_FAILURE,
  DISCOUNT_CODE_MESSAGE,
  findDiscountCode,
  isCodeValidAt,
  redeemDiscountCode,
  toExtraDiscount,
  type DiscountCodeFailure,
} from '@/lib/discount-codes';
import { clinicNow } from '@/lib/datetime';
import { parsePageParams, paginate } from '@/lib/pagination';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

const manualLine = z.object({
  description: z.string().trim().min(1).max(255),
  quantity: z.coerce.number().int().min(1).default(1),
  unitPrice: z.coerce.number().int(),
  discountAmount: z.coerce.number().int().min(0).default(0),
  /**
   * Constrained to the vocabulary: computeInvoiceTotals() branches on the
   * literal 'discount', so a plausible-looking 'promo' would be counted as a
   * PROCEDURE with a negative unitPrice — understating the subtotal, leaving
   * discountTotal at 0, and still reconciling, so nothing would catch it.
   */
  itemType: z
    .enum(valuesOf(INVOICE_ITEM_TYPE) as [string, ...string[]])
    .default(INVOICE_ITEM_TYPE.PROCEDURE),
  procedureId: z.string().max(255).nullable().optional(),
  teeth: z.string().max(100).nullable().optional(),
});

/**
 * A concession decided at billing time.
 *
 * Percentages are capped at 100 here, unlike treatment_plan_items.discountValue
 * which relies on the runtime clamp: on a quote a visible '120%' is absurd to
 * whoever reads it back, whereas on an invoice the clamp silently rewrites the
 * number staff typed.
 */
const extraDiscountSchema = z
  .object({
    discountType: z.enum(valuesOf(DISCOUNT_TYPE) as [string, ...string[]]),
    value: z.coerce.number().int().min(1),
    /** Goes on the printed line and into the audit row — never optional. */
    reason: z.string().trim().min(1).max(120),
  })
  .refine((d) => d.discountType !== DISCOUNT_TYPE.PERCENTAGE || d.value <= 100, {
    path: ['value'],
    message: 'A percentage discount cannot exceed 100%.',
  });

const createSchema = z
  .object({
    patientId: z.string().min(1).max(255),
    /** Exactly one source: a visit, a plan, or explicit lines. */
    visitId: z.string().max(255).nullable().optional(),
    treatmentPlanId: z.string().max(255).nullable().optional(),
    treatmentPlanItemIds: z.array(z.string()).optional(),
    lines: z.array(manualLine).optional(),
    dueDate: z.coerce.date().nullable().optional(),
    notes: z.string().max(65_535).nullable().optional(),
    applyPatientDiscount: z.boolean().optional(),
    discountCode: z.string().trim().min(1).max(30).optional(),
    extraDiscount: extraDiscountSchema.optional(),
  })
  .refine((v) => !(v.discountCode && v.extraDiscount), {
    path: ['discountCode'],
    message: 'Apply either a discount code or a manual discount, not both.',
  });

/** Thrown inside the transaction; unwrapped in the catch below. */
function codeRejection(failure: DiscountCodeFailure) {
  return Object.assign(new Error(failure), { discountCodeFailure: failure });
}

export const GET = withAuth(PERMISSIONS.BILLING_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const page = parsePageParams(url);
  const patientId = url.searchParams.get('patientId');
  const status = url.searchParams.get('status');

  const filters = [];
  if (branchIds) filters.push(inArray(invoices.branchId, branchIds));
  if (patientId) filters.push(eq(invoices.patientId, patientId));
  if (status && status !== 'all') filters.push(inArray(invoices.status, status.split(',')));
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        subtotal: invoices.subtotal,
        discountTotal: invoices.discountTotal,
        totalAmount: invoices.totalAmount,
        paidAmount: invoices.paidAmount,
        status: invoices.status,
        patientId: invoices.patientId,
        patientMrn: patients.mrn,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
      })
      .from(invoices)
      .leftJoin(patients, eq(invoices.patientId, patients.id))
      .where(where)
      .orderBy(desc(invoices.issueDate))
      .limit(page.pageSize)
      .offset(page.offset),
    db.select({ n: sql<number>`count(*)` }).from(invoices).where(where),
  ]);

  return NextResponse.json(paginate(rows, Number(counted?.n ?? 0), page));
});

export const POST = withAuth(PERMISSIONS.BILLING_CREATE, async (req, ctx) => {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Inventing a discount at the desk reduces what the patient owes by fiat —
  // economically a partial write-off, so it takes the write-off permission.
  // Redeeming a CODE does not: that discount was authorised when the code was
  // created. Same shape as the refund gate in app/api/payments/route.ts.
  if (input.extraDiscount && !ctx.can(PERMISSIONS.BILLING_WAIVE)) {
    return NextResponse.json(
      {
        error: 'You do not have permission to apply a discount to an invoice.',
        code: 'FORBIDDEN',
      },
      { status: 403 }
    );
  }

  const patient = await loadPatient(ctx, input.patientId);

  // Branch comes from the patient; a visit or plan must belong to them.
  if (input.visitId) {
    const visit = await loadVisit(ctx, input.visitId);
    if (visit.patientId !== patient.id) {
      return NextResponse.json({ error: 'That visit belongs to another patient.' }, { status: 400 });
    }
  }
  if (input.treatmentPlanId) {
    const plan = await loadTreatmentPlan(ctx, input.treatmentPlanId);
    if (plan.patientId !== patient.id) {
      return NextResponse.json({ error: 'That plan belongs to another patient.' }, { status: 400 });
    }
  }

  for (let attempt = 1; attempt <= INVOICE_NUMBER_RETRIES; attempt++) {
    try {
      const created = await db.transaction(async (tx) => {
        let lines: DraftLine[] = [];

        if (input.visitId) {
          lines = await buildLinesFromVisit(tx, input.visitId);
        } else if (input.treatmentPlanId) {
          lines = await buildLinesFromTreatmentPlan(
            tx,
            input.treatmentPlanId,
            input.treatmentPlanItemIds
          );
        } else if (input.lines?.length) {
          lines = input.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountAmount: l.discountAmount,
            itemType: l.itemType,
            teeth: l.teeth ?? null,
            procedureId: l.procedureId ?? null,
          }));
        }

        if (!lines.length) {
          // Everything eligible was already billed, or nothing was supplied.
          throw Object.assign(new Error('NOTHING_TO_INVOICE'), { nothingToInvoice: true });
        }

        let code: Awaited<ReturnType<typeof findDiscountCode>> = null;
        let extraDiscount: ExtraDiscountInput | null = null;

        if (input.discountCode) {
          code = await findDiscountCode(tx, input.discountCode);
          // Advisory: gives the front desk a real reason before anything is
          // written. redeemDiscountCode() below is what actually enforces the
          // usage limit, and uq_inv_code_patient enforces once-per-patient.
          const failure = isCodeValidAt(code, {
            now: clinicNow(),
            branchId: patient.branchId,
          });
          if (failure) throw codeRejection(failure);
          extraDiscount = toExtraDiscount(code!);
        } else if (input.extraDiscount) {
          const { discountType, value, reason } = input.extraDiscount;
          const magnitude = discountType === DISCOUNT_TYPE.PERCENTAGE ? ` (${value}%)` : '';
          extraDiscount = {
            discountType,
            value,
            label: `Discount${magnitude} — ${reason}`,
          };
        }

        const created = await createInvoice(tx, {
          patientId: patient.id,
          branchId: patient.branchId,
          visitId: input.visitId ?? null,
          treatmentPlanId: input.treatmentPlanId ?? null,
          dueDate: input.dueDate ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
          lines,
          applyPatientDiscount: input.applyPatientDiscount ?? true,
          extraDiscount,
          discountCodeId: code?.id ?? null,
        });

        if (code) {
          // LAST write in the transaction, on purpose: the shortest possible
          // lock window, and a rolled-back attempt takes the increment with it
          // rather than burning one redemption per retry.
          if (!(await redeemDiscountCode(tx, code.id))) {
            throw codeRejection(DISCOUNT_CODE_FAILURE.EXHAUSTED);
          }
          await writeAuditLog(
            {
              actor: ctx,
              action: AUDIT_ACTION.UPDATE,
              entityType: AUDIT_ENTITY.DISCOUNT_CODE,
              entityId: code.id,
              patientId: patient.id,
              branchId: patient.branchId,
              before: { usedCount: code.usedCount },
              after: {
                usedCount: code.usedCount + 1,
                invoiceId: created.invoice.id,
                code: code.code,
                discountType: code.discountType,
                discountValue: code.discountValue,
              },
              request: req,
            },
            tx
          );
        }

        return created;
      });

      await writeAuditLog({
        actor: ctx,
        action: AUDIT_ACTION.CREATE,
        entityType: AUDIT_ENTITY.INVOICE,
        entityId: created.invoice.id,
        patientId: patient.id,
        branchId: patient.branchId,
        after: {
          ...created.invoice,
          // The header's discountTotal records THAT a discount happened but not
          // why or on whose authority. audit_logs is the medico-legal record,
          // so the reason travels with it.
          extraDiscount: input.extraDiscount ?? null,
          discountCode: input.discountCode ?? null,
        },
        request: req,
      });

      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      if ((error as { nothingToInvoice?: boolean }).nothingToInvoice) {
        return NextResponse.json(
          {
            error: 'There is nothing left to invoice — this work has already been billed.',
            code: 'NOTHING_TO_INVOICE',
          },
          { status: 409 }
        );
      }
      // Both discount-code branches MUST precede the retry check: they fail
      // identically on every attempt, so retrying only burns transactions and
      // then reports a numbering problem that never happened.
      const failure = (error as { discountCodeFailure?: DiscountCodeFailure })
        .discountCodeFailure;
      if (failure) {
        return NextResponse.json(
          { error: DISCOUNT_CODE_MESSAGE[failure], code: failure },
          { status: 409 }
        );
      }
      if (isDuplicateCodeRedemption(error)) {
        return NextResponse.json(
          {
            error: DISCOUNT_CODE_MESSAGE[DISCOUNT_CODE_FAILURE.ALREADY_USED],
            code: DISCOUNT_CODE_FAILURE.ALREADY_USED,
          },
          { status: 409 }
        );
      }
      // Another invoice took the same number between our read and write.
      if (isDuplicateInvoiceNumber(error) && attempt < INVOICE_NUMBER_RETRIES) continue;
      throw error;
    }
  }

  return NextResponse.json(
    { error: 'Could not allocate an invoice number. Please try again.' },
    { status: 409 }
  );
});
