import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, chairs } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { CLINICAL_STAFF_TYPES } from '@/lib/enums';
import { getClinicHours } from '@/lib/availability';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

/** Chairs, bookable staff and clinic hours — what the calendar needs to draw. */
export const GET = withAuth(PERMISSIONS.APPOINTMENTS_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { activeBranchId, branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));

  const [chairRows, staffRows, hours] = await Promise.all([
    db
      .select({ id: chairs.id, name: chairs.name, branchId: chairs.branchId })
      .from(chairs)
      .where(
        and(
          eq(chairs.isActive, true),
          branchIds ? inArray(chairs.branchId, branchIds) : undefined
        )
      )
      .orderBy(chairs.name),
    db
      .select({
        id: adminUsers.id,
        name: adminUsers.name,
        staffType: adminUsers.staffType,
        branchId: adminUsers.branchId,
      })
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.isActive, true),
          inArray(adminUsers.staffType, CLINICAL_STAFF_TYPES as string[]),
          // Head-office staff (null branchId) can work at any branch.
          branchIds
            ? or(inArray(adminUsers.branchId, branchIds), isNull(adminUsers.branchId))
            : undefined
        )
      )
      .orderBy(adminUsers.name),
    getClinicHours(),
  ]);

  return NextResponse.json({
    branchId: activeBranchId,
    chairs: chairRows,
    dentists: staffRows,
    hours,
  });
});
