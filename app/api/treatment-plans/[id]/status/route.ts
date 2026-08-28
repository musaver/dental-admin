import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { treatmentPlans } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadTreatmentPlan } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  TREATMENT_PLAN_STATUS,
  valuesOf,
} from '@/lib/enums';
import { applyPlanStatusChange, canTransition } from '@/lib/treatment-plans';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const schema = z.object({
  status: z.enum(valuesOf(TREATMENT_PLAN_STATUS) as [string, ...string[]]),
  reason: z.string().max(255).nullable().optional(),
  note: z.string().max(255).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

/**
 * Moves a plan through its lifecycle.
 *
 * Separate from PUT because the status and its timestamps must change
 * together, and because the legal transitions are a rule rather than a field.
 */
export const POST = withAuth(
  PERMISSIONS.TREATMENT_PLANS_EDIT,
  async (req, ctx, { params }: Params) => {
    const { id } = await params;
    const before = await loadTreatmentPlan(ctx, id);

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { status, reason, note } = parsed.data;

    if (!canTransition(before.status, status)) {
      return NextResponse.json(
        {
          error: `A ${before.status.replace(/_/g, ' ')} plan cannot become ${status.replace(/_/g, ' ')}.`,
          code: 'ILLEGAL_TRANSITION',
        },
        { status: 409 }
      );
    }

    // Cancelling or rejecting without a reason leaves the record unexplainable
    // later, which is exactly when someone needs to know why.
    if (
      (status === TREATMENT_PLAN_STATUS.CANCELLED || status === TREATMENT_PLAN_STATUS.REJECTED) &&
      !reason?.trim()
    ) {
      return NextResponse.json(
        { error: 'Give a reason so the record explains itself later.', details: { reason: ['Required'] } },
        { status: 400 }
      );
    }

    const patch = applyPlanStatusChange({
      from: before.status,
      to: status as never,
      now: clinicNow(),
      existingProposedAt: before.proposedAt,
      reason,
      note,
    });

    await db
      .update(treatmentPlans)
      .set({ ...patch, updatedAt: clinicNow() })
      .where(eq(treatmentPlans.id, id));

    const after = await loadTreatmentPlan(ctx, id);

    await writeAuditLog({
      actor: ctx,
      action: AUDIT_ACTION.UPDATE,
      entityType: AUDIT_ENTITY.TREATMENT_PLAN,
      entityId: id,
      patientId: before.patientId,
      branchId: before.branchId,
      before: { status: before.status, proposedAt: before.proposedAt, acceptedAt: before.acceptedAt },
      after: { status: after.status, proposedAt: after.proposedAt, acceptedAt: after.acceptedAt },
      request: req,
    });

    return NextResponse.json(after);
  }
);
