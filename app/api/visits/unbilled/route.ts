import { NextResponse } from 'next/server';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { parsePageParams, paginate } from '@/lib/pagination';
import { countUnbilledVisits, unbilledVisits } from '@/lib/reports';

/**
 * Completed visits with work nobody has billed — the front desk's backlog.
 *
 * GATED ON BILLING, NOT CLINICAL, unlike its sibling GET /api/visits. The
 * cheaper option was an ?unbilled=1 flag on that route, but it requires
 * clinical_view, and nothing guarantees the Receptionist holds it — which
 * would make this worklist invisible to the one person whose job it is.
 *
 * The billing gate leaks nothing new: invoice lines already carry procedure
 * names, and GET /api/invoices/[id] already serves them to anyone with
 * billing_view. A patient name, a procedure count and an amount is strictly
 * less than that.
 *
 * Routing note: this static segment is a sibling of app/api/visits/[id]/.
 * Static wins over dynamic, so /api/visits/unbilled always resolves here and
 * never to [id] — worth saying, because two siblings carrying different
 * permissions is surprising otherwise.
 */
export const GET = withAuth(PERMISSIONS.BILLING_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const page = parsePageParams(url);

  const [rows, total] = await Promise.all([
    unbilledVisits({ branchIds, limit: page.pageSize, offset: page.offset }),
    countUnbilledVisits(branchIds),
  ]);

  return NextResponse.json(paginate(rows, total, page));
});
