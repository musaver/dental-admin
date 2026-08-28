import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { procedures, treatmentPlanItems } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadTreatmentPlan } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  DISCOUNT_TYPE,
  TREATMENT_PLAN_ITEM_STATUS,
  valuesOf,
} from '@/lib/enums';
import { recomputePlanTotals } from '@/lib/derive';
import { computeItemNet } from '@/lib/money';
import { isPricingLocked } from '@/lib/treatment-plans';
import { packSurfaces, packTeeth, parseSurfaces, parseTeeth, toothCount } from '@/lib/odontogram';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const itemSchema = z.object({
  procedureId: z.string().min(1).max(255),
  teeth: z.array(z.string()).optional(),
  surfaces: z.array(z.string()).optional(),
  toothConditionId: z.string().max(255).nullable().optional(),
  /** Omit to take the procedure's catalogue price. */
  unitPrice: z.coerce.number().int().min(0).optional(),
  quantity: z.coerce.number().int().min(1).optional(),
  discountType: z.enum(valuesOf(DISCOUNT_TYPE) as [string, ...string[]]).nullable().optional(),
  discountValue: z.coerce.number().int().min(0).nullable().optional(),
  notes: z.string().max(65_535).nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(
  PERMISSIONS.TREATMENT_PLANS_EDIT,
  async (req, ctx, { params }: Params) => {
    const { id } = await params;
    const plan = await loadTreatmentPlan(ctx, id);

    if (isPricingLocked(plan.status)) {
      return NextResponse.json(
        {
          error:
            'This plan has been accepted, so its pricing is fixed. Create a new plan for additional work.',
          code: 'PRICING_LOCKED',
        },
        { status: 409 }
      );
    }

    const parsed = itemSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const [procedure] = await db
      .select()
      .from(procedures)
      .where(eq(procedures.id, input.procedureId))
      .limit(1);

    if (!procedure) {
      return NextResponse.json({ error: 'That procedure does not exist.' }, { status: 400 });
    }

    const teeth = packTeeth(input.teeth ?? []);

    // For a per-tooth procedure the quantity IS the number of teeth, unless
    // the caller overrides it. Getting this wrong under- or over-bills by the
    // tooth count, so the rule lives here rather than in the UI.
    const quantity =
      input.quantity ?? (procedure.isPerTooth && teeth ? toothCount(teeth) : 1);

    const unitPrice = input.unitPrice ?? procedure.defaultPrice;

    const draft = {
      quantity,
      unitPrice,
      discountType: input.discountType ?? null,
      discountValue: input.discountValue ?? 0,
    };

    const now = clinicNow();
    const row = {
      id: uuidv4(),
      treatmentPlanId: id,
      procedureId: procedure.id,
      teeth,
      surfaces: packSurfaces(parseSurfaces((input.surfaces ?? []).join(''))),
      toothConditionId: input.toothConditionId ?? null,
      unitPrice,
      quantity,
      discountType: draft.discountType,
      discountValue: draft.discountValue,
      netAmount: computeItemNet(draft),
      status: TREATMENT_PLAN_ITEM_STATUS.PENDING,
      appointmentId: null,
      visitProcedureId: null,
      sortOrder: input.sortOrder ?? 0,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const totals = await db.transaction(async (tx) => {
      await tx.insert(treatmentPlanItems).values(row);
      // The plan's three money columns are denormalised; recompute inside the
      // same transaction so a rollback cannot leave them describing this row.
      return recomputePlanTotals(id, tx);
    });

    await writeAuditLog({
      actor: ctx,
      action: AUDIT_ACTION.CREATE,
      entityType: AUDIT_ENTITY.TREATMENT_PLAN_ITEM,
      entityId: row.id,
      patientId: plan.patientId,
      branchId: plan.branchId,
      after: row,
      request: req,
    });

    return NextResponse.json({ item: row, totals }, { status: 201 });
  }
);
