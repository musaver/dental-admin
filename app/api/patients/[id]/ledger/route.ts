import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadPatient } from '@/lib/loaders';
import { getPatientLedger } from '@/lib/ledger';

type Params = { params: Promise<{ id: string }> };

/** The patient account: invoices and payments interleaved, with a balance. */
export const GET = withAuth(PERMISSIONS.BILLING_VIEW, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  await loadPatient(ctx, id);

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const ledger = await getPatientLedger(id, {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  });

  return NextResponse.json(ledger);
});
