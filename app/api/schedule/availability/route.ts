import { NextResponse } from 'next/server';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { getAvailability, getClinicHours } from '@/lib/availability';
import { fromDateKey } from '@/lib/datetime';

export const GET = withAuth(PERMISSIONS.APPOINTMENTS_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { activeBranchId } = resolveBranchScope(ctx, url.searchParams.get('branchId'));

  const branchId = activeBranchId ?? url.searchParams.get('branchId');
  if (!branchId) {
    return NextResponse.json(
      { error: 'Choose a branch to see availability for.' },
      { status: 400 }
    );
  }

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from) {
    return NextResponse.json({ error: 'A date is required.' }, { status: 400 });
  }

  const hours = await getClinicHours();
  const durationMinutes = Number(url.searchParams.get('durationMinutes')) || hours.slotMinutes * 2;

  const days = await getAvailability({
    branchId,
    dentistId: url.searchParams.get('dentistId'),
    chairId: url.searchParams.get('chairId'),
    from: fromDateKey(from),
    to: fromDateKey(to ?? from),
    durationMinutes,
    excludeAppointmentId: url.searchParams.get('excludeAppointmentId'),
  });

  return NextResponse.json({ hours, days });
});
