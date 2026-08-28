import { NextResponse } from 'next/server';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import {
  collectionsByDay,
  collectionsByMethod,
  outstandingSummary,
  revenueByCategory,
  revenueByDentist,
  type ReportRange,
} from '@/lib/reports';
import { addDays, clinicNow, fromDateKey, startOfDay } from '@/lib/datetime';

/** Gated on reports_financial — distinct from clinical reporting by design. */
export const GET = withAuth(PERMISSIONS.REPORTS_FINANCIAL, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const range: ReportRange = {
    from: from ? fromDateKey(from) : startOfDay(addDays(clinicNow(), -30)),
    // Exclusive upper bound: "to 2026-08-28" includes all of that day.
    to: to ? addDays(fromDateKey(to), 1) : addDays(startOfDay(clinicNow()), 1),
    branchIds,
  };

  const [byDay, byMethod, outstanding, byDentist, byCategory] = await Promise.all([
    collectionsByDay(range),
    collectionsByMethod(range),
    outstandingSummary(branchIds),
    revenueByDentist(range),
    revenueByCategory(range),
  ]);

  return NextResponse.json({ range, byDay, byMethod, outstanding, byDentist, byCategory });
});
