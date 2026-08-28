import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { treatmentPlans } from '@/lib/schema';
import { requirePortalContext, assertOwned } from '@/lib/portal-auth';
import { toErrorResponse } from '@/lib/rbac';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY, TREATMENT_PLAN_STATUS } from '@/lib/enums';
import { applyPlanStatusChange } from '@/lib/treatment-plans';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';

type Params = { params: Promise<{ id: string }> };

/**
 * The one write that earns the portal its keep: the patient accepts their own
 * treatment plan, from home, without a phone call — which is exactly the
 * moment plans otherwise go cold.
 *
 * Only proposed → accepted, only on their own plan, and 404 for anything not
 * theirs so plan ids cannot be probed. Goes through the same state machine as
 * staff acceptance, so proposedAt/acceptedAt behave identically.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const ctx = await requirePortalContext();
    const { id } = await params;

    const [plan] = await db.select().from(treatmentPlans).where(eq(treatmentPlans.id, id)).limit(1);
    assertOwned(plan, ctx);

    if (plan!.status !== TREATMENT_PLAN_STATUS.PROPOSED) {
      return NextResponse.json(
        {
          error:
            plan!.status === TREATMENT_PLAN_STATUS.ACCEPTED
              ? 'You have already accepted this plan.'
              : 'This plan is not currently open for acceptance. Please contact the clinic.',
          code: 'NOT_PROPOSED',
        },
        { status: 409 }
      );
    }

    const now = clinicNow();
    const patch = applyPlanStatusChange({
      from: plan!.status,
      to: TREATMENT_PLAN_STATUS.ACCEPTED,
      now,
      existingProposedAt: plan!.proposedAt,
      note: 'Accepted via patient portal',
    });

    await db
      .update(treatmentPlans)
      .set({ ...patch, updatedAt: now })
      .where(eq(treatmentPlans.id, id));

    await writeAuditLog({
      actor: { userId: ctx.portalUserId, email: ctx.email ?? 'patient' },
      action: AUDIT_ACTION.UPDATE,
      entityType: AUDIT_ENTITY.TREATMENT_PLAN,
      entityId: id,
      patientId: plan!.patientId,
      branchId: plan!.branchId,
      before: { status: plan!.status },
      after: { status: TREATMENT_PLAN_STATUS.ACCEPTED, via: 'portal' },
      request: req,
    });

    return NextResponse.json({ accepted: true, acceptedAt: now });
  } catch (error) {
    return toErrorResponse(error);
  }
}
