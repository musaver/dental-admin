import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { procedures, treatmentPlanItems, visitProcedures } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadVisit } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  TREATMENT_PLAN_ITEM_STATUS,
  VISIT_PROCEDURE_STATUS,
  valuesOf,
} from '@/lib/enums';
import { recomputePlanTotals } from '@/lib/derive';
import { packSurfaces, packTeeth, parseSurfaces } from '@/lib/odontogram';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const schema = z.object({
  procedureId: z.string().min(1).max(255),
  teeth: z.array(z.string()).optional(),
  surfaces: z.array(z.string()).optional(),
  /** Omit to take the catalogue price. */
  price: z.coerce.number().int().min(0).optional(),
  status: z.enum(valuesOf(VISIT_PROCEDURE_STATUS) as [string, ...string[]]).optional(),
  performedBy: z.string().max(255).optional(),
  treatmentPlanItemId: z.string().max(255).nullable().optional(),
  notes: z.string().max(65_535).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(PERMISSIONS.CLINICAL_EDIT, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const visit = await loadVisit(ctx, id);

  const parsed = schema.safeParse(await req.json());
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

  const now = clinicNow();
  const row = {
    id: uuidv4(),
    visitId: id,
    // Denormalised from the visit so patient-scoped queries need no join.
    patientId: visit.patientId,
    procedureId: procedure.id,
    treatmentPlanItemId: input.treatmentPlanItemId ?? null,
    teeth: packTeeth(input.teeth ?? []),
    surfaces: packSurfaces(parseSurfaces((input.surfaces ?? []).join(''))),
    // visit_procedures.price is PER UNIT, matching treatment_plan_items.
    // There is no quantity column here; the tooth count carries that.
    price: input.price ?? procedure.defaultPrice,
    performedBy: input.performedBy ?? ctx.userId,
    status: input.status ?? VISIT_PROCEDURE_STATUS.COMPLETED,
    notes: input.notes ?? null,
    createdAt: now,
  };

  await db.transaction(async (tx) => {
    await tx.insert(visitProcedures).values(row);

    // Closing the loop on the plan: both sides of the pair, in one
    // transaction, or the plan silently loses track of what has been done.
    if (input.treatmentPlanItemId) {
      const [item] = await tx
        .select({ id: treatmentPlanItems.id, planId: treatmentPlanItems.treatmentPlanId })
        .from(treatmentPlanItems)
        .where(eq(treatmentPlanItems.id, input.treatmentPlanItemId))
        .limit(1);

      if (item) {
        await tx
          .update(treatmentPlanItems)
          .set({
            visitProcedureId: row.id,
            status: TREATMENT_PLAN_ITEM_STATUS.COMPLETED,
            updatedAt: now,
          })
          .where(eq(treatmentPlanItems.id, item.id));

        await recomputePlanTotals(item.planId, tx);
      }
    }
  });

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.VISIT_PROCEDURE,
    entityId: row.id,
    patientId: visit.patientId,
    branchId: visit.branchId,
    after: row,
    request: req,
  });

  return NextResponse.json(row, { status: 201 });
});
