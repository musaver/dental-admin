import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, treatmentPlans } from '@/lib/schema';
import { requirePortalContext } from '@/lib/portal-auth';
import { toErrorResponse } from '@/lib/rbac';
import { TREATMENT_PLAN_STATUS } from '@/lib/enums';
import { desc, eq, inArray } from 'drizzle-orm';

/**
 * The patient's treatment plans.
 *
 * Drafts are not shown: a draft is the dentist's thinking, not a quote that
 * has been put to the patient. Everything from 'proposed' onwards is theirs
 * to see.
 */
export async function GET() {
  try {
    const ctx = await requirePortalContext();
    if (!ctx.patientIds.length) return NextResponse.json([]);

    const rows = await db
      .select({
        id: treatmentPlans.id,
        title: treatmentPlans.title,
        status: treatmentPlans.status,
        totalAmount: treatmentPlans.totalAmount,
        discountTotal: treatmentPlans.discountTotal,
        netAmount: treatmentPlans.netAmount,
        proposedAt: treatmentPlans.proposedAt,
        acceptedAt: treatmentPlans.acceptedAt,
        patientId: treatmentPlans.patientId,
        dentistName: adminUsers.name,
      })
      .from(treatmentPlans)
      .leftJoin(adminUsers, eq(treatmentPlans.dentistId, adminUsers.id))
      .where(inArray(treatmentPlans.patientId, ctx.patientIds))
      .orderBy(desc(treatmentPlans.createdAt))
      .limit(50);

    return NextResponse.json(rows.filter((p) => p.status !== TREATMENT_PLAN_STATUS.DRAFT));
  } catch (error) {
    return toErrorResponse(error);
  }
}
