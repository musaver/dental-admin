import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { branches } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Branch names, for pickers.
 *
 * Anyone who can register a patient needs these: head office has to say which
 * branch a new record belongs to (see resolveWritingBranch). GET /api/settings
 * already returns branches but is gated on settings_manage, which a
 * receptionist does not have — hence `withAuth(null)`, staff-only with no
 * specific right. Branch names are on the clinic's own letterhead.
 *
 * Scoped staff get exactly their own branch back, head office gets all of
 * them, which is how a form decides whether to show a selector at all without
 * having to ask what the caller's role is.
 */
export const GET = withAuth(null, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));

  const rows = await db
    .select({ id: branches.id, name: branches.name, code: branches.code })
    .from(branches)
    .where(
      and(
        eq(branches.isActive, true),
        branchIds ? inArray(branches.id, branchIds) : undefined
      )
    )
    .orderBy(branches.name);

  return NextResponse.json(rows);
});
