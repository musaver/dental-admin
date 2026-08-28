import { NextResponse } from 'next/server';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import {
  appointmentStats,
  leadSourcePerformance,
  newPatients,
  recallCompliance,
  treatmentAcceptance,
  type ReportRange,
} from '@/lib/reports';
import { addDays, clinicNow, fromDateKey, startOfDay } from '@/lib/datetime';

export const GET = withAuth(PERMISSIONS.REPORTS_CLINICAL, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const range: ReportRange = {
    from: from ? fromDateKey(from) : startOfDay(addDays(clinicNow(), -30)),
    to: to ? addDays(fromDateKey(to), 1) : addDays(startOfDay(clinicNow()), 1),
    branchIds,
  };

  const [appointments, acceptance, patients, leads, recalls] = await Promise.all([
    appointmentStats(range),
    treatmentAcceptance(range),
    newPatients(range),
    leadSourcePerformance(range),
    recallCompliance(branchIds),
  ]);

  return NextResponse.json({ range, appointments, acceptance, patients, leads, recalls });
});
