import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { discountCodes } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import { normalizeDiscountCode } from '@/lib/discount-codes';
import { discountCodeSchema } from '@/lib/validation/discount-code';
import { clinicNow, endOfDay, fromDateKey } from '@/lib/datetime';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/** MySQL duplicate-key on discount_codes_code_unique. */
function isDuplicateCode(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { errno?: number }).errno === 1062
  );
}

/**
 * The discount code catalogue.
 *
 * Readable by anyone who can see billing — the front desk has to be able to
 * check whether a code a patient quotes is real.
 */
export const GET = withAuth(PERMISSIONS.BILLING_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const includeInactive = url.searchParams.get('all') === '1';

  const rows = await db
    .select()
    .from(discountCodes)
    .where(
      and(
        includeInactive ? undefined : eq(discountCodes.isActive, true),
        // A null branchId means the code is valid everywhere, so it must
        // survive branch scoping rather than being filtered out.
        branchIds
          ? or(isNull(discountCodes.branchId), inArray(discountCodes.branchId, branchIds))
          : undefined
      )
    )
    .orderBy(asc(discountCodes.code));

  return NextResponse.json(rows);
});

/**
 * Authoring a discount is the same authority as granting one, so this is gated
 * on billing_waive rather than on a 32nd permission slug: the 31 in
 * lib/permissions.ts are the exact strings stored in admin_roles.permissions on
 * the live database, and a new one would be held by no role at all — Owner
 * included, since there is no bypass — until that column were edited by hand.
 */
export const POST = withAuth(PERMISSIONS.BILLING_WAIVE, async (req, ctx) => {
  const parsed = discountCodeSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Please correct the highlighted fields.',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const now = clinicNow();

  const row = {
    id: uuidv4(),
    code: normalizeDiscountCode(input.code),
    description: input.description ?? null,
    discountType: input.discountType,
    discountValue: input.discountValue,
    branchId: input.branchId ?? null,
    validFrom: input.validFrom ? fromDateKey(input.validFrom) : null,
    // endOfDay() is midnight on the NEXT day — an exclusive upper bound. A code
    // set to end "on the 30th" is therefore usable all through the 30th, which
    // a closed 23:59:59 bound would not quite manage.
    validUntil: input.validUntil ? endOfDay(fromDateKey(input.validUntil)) : null,
    maxRedemptions: input.maxRedemptions ?? null,
    usedCount: 0,
    isActive: input.isActive ?? true,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.insert(discountCodes).values(row);
  } catch (error) {
    if (isDuplicateCode(error)) {
      return NextResponse.json(
        { error: 'That code already exists.', code: 'DUPLICATE_CODE' },
        { status: 409 }
      );
    }
    throw error;
  }

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.DISCOUNT_CODE,
    entityId: row.id,
    branchId: row.branchId,
    after: row,
    request: req,
  });

  return NextResponse.json(row, { status: 201 });
});
