import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { treatmentPlanItems } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadTreatmentPlan, loadTreatmentPlanItem } from '@/lib/loaders';
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
import { packSurfaces, packTeeth, parseSurfaces } from '@/lib/odontogram';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const updateSchema = z.object({
  teeth: z.array(z.string()).optional(),
  surfaces: z.array(z.string()).optional(),
  unitPrice: z.coerce.number().int().min(0).optional(),
  quantity: z.coerce.number().int().min(1).optional(),
  discountType: z.enum(valuesOf(DISCOUNT_TYPE) as [string, ...string[]]).nullable().optional(),
  discountValue: z.coerce.number().int().min(0).nullable().optional(),
  status: z.enum(valuesOf(TREATMENT_PLAN_ITEM_STATUS) as [string, ...string[]]).optional(),
  notes: z.string().max(65_535).nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

/** Fields that change what the patient was quoted. */
const PRICING_FIELDS = ['unitPrice', 'quantity', 'discountType', 'discountValue', 'teeth'] as const;

type Params = { params: Promise<{ id: string; itemId: string }> };

export const PATCH = withAuth(
  PERMISSIONS.TREATMENT_PLANS_EDIT,
  async (req, ctx, { params }: Params) => {
    const { id, itemId } = await params;
    const plan = await loadTreatmentPlan(ctx, id);
    const before = await loadTreatmentPlanItem(ctx, itemId);

    if (before.treatmentPlanId !== id) {
      return NextResponse.json({ error: 'Item not found on this plan.' }, { status: 404 });
    }

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // Progress can still be recorded on an accepted plan; the NUMBERS cannot
    // move, because they are what the patient agreed to.
    const touchesPricing = PRICING_FIELDS.some((f) => input[f] !== undefined);
    if (touchesPricing && isPricingLocked(plan.status)) {
      return NextResponse.json(
        {
          error:
            'This plan has been accepted, so its pricing is fixed. Record progress instead, or create a new plan.',
          code: 'PRICING_LOCKED',
        },
        { status: 409 }
      );
    }

    const patch: Record<string, unknown> = { updatedAt: clinicNow() };
    if (input.teeth !== undefined) patch.teeth = packTeeth(input.teeth);
    if (input.surfaces !== undefined) {
      patch.surfaces = packSurfaces(parseSurfaces(input.surfaces.join('')));
    }
    for (const field of ['unitPrice', 'quantity', 'discountType', 'discountValue', 'status', 'notes', 'sortOrder'] as const) {
      if (input[field] !== undefined) patch[field] = input[field];
    }

    // netAmount is denormalised on the item itself — the seventh such field,
    // and the one most easily forgotten.
    if (touchesPricing) {
      patch.netAmount = computeItemNet({
        quantity: (input.quantity ?? before.quantity) ?? 1,
        unitPrice: input.unitPrice ?? before.unitPrice,
        discountType: input.discountType !== undefined ? input.discountType : before.discountType,
        discountValue:
          input.discountValue !== undefined ? input.discountValue : before.discountValue,
      });
    }

    const totals = await db.transaction(async (tx) => {
      await tx.update(treatmentPlanItems).set(patch).where(eq(treatmentPlanItems.id, itemId));
      return recomputePlanTotals(id, tx);
    });

    const after = await loadTreatmentPlanItem(ctx, itemId);

    await writeAuditLog({
      actor: ctx,
      action: AUDIT_ACTION.UPDATE,
      entityType: AUDIT_ENTITY.TREATMENT_PLAN_ITEM,
      entityId: itemId,
      patientId: plan.patientId,
      branchId: plan.branchId,
      before,
      after,
      request: req,
    });

    return NextResponse.json({ item: after, totals });
  }
);

export const DELETE = withAuth(
  PERMISSIONS.TREATMENT_PLANS_EDIT,
  async (req, ctx, { params }: Params) => {
    const { id, itemId } = await params;
    const plan = await loadTreatmentPlan(ctx, id);
    const before = await loadTreatmentPlanItem(ctx, itemId);

    if (before.treatmentPlanId !== id) {
      return NextResponse.json({ error: 'Item not found on this plan.' }, { status: 404 });
    }

    if (isPricingLocked(plan.status)) {
      return NextResponse.json(
        {
          error: 'This plan has been accepted. Cancel the item instead of removing it.',
          code: 'PRICING_LOCKED',
        },
        { status: 409 }
      );
    }

    const totals = await db.transaction(async (tx) => {
      await tx.delete(treatmentPlanItems).where(eq(treatmentPlanItems.id, itemId));
      return recomputePlanTotals(id, tx);
    });

    await writeAuditLog({
      actor: ctx,
      action: AUDIT_ACTION.DELETE,
      entityType: AUDIT_ENTITY.TREATMENT_PLAN_ITEM,
      entityId: itemId,
      patientId: plan.patientId,
      branchId: plan.branchId,
      before,
      request: req,
    });

    return NextResponse.json({ message: 'Item removed.', totals });
  }
);
