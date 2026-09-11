import { DISCOUNT_TYPE } from './enums.ts';
import { formatPKR } from './money.ts';

/**
 * Discount code rules, with no database in sight.
 *
 * Split from lib/discount-codes.ts the way patient-identity.ts is split from
 * patients.ts: everything here is pure, so it is unit tested — and the validity
 * window in particular MUST be, because it is the one part of this feature that
 * can be right on Vercel and wrong on a developer's machine. `npm run
 * test:timezones` runs these under both TZ=UTC and TZ=Asia/Karachi.
 */

export const DISCOUNT_CODE_FAILURE = {
  UNKNOWN: 'DISCOUNT_CODE_UNKNOWN',
  INACTIVE: 'DISCOUNT_CODE_INACTIVE',
  NOT_YET_VALID: 'DISCOUNT_CODE_NOT_YET_VALID',
  EXPIRED: 'DISCOUNT_CODE_EXPIRED',
  EXHAUSTED: 'DISCOUNT_CODE_EXHAUSTED',
  WRONG_BRANCH: 'DISCOUNT_CODE_WRONG_BRANCH',
  ALREADY_USED: 'DISCOUNT_CODE_ALREADY_USED',
} as const;
export type DiscountCodeFailure =
  (typeof DISCOUNT_CODE_FAILURE)[keyof typeof DISCOUNT_CODE_FAILURE];

/** What the front desk is told. */
export const DISCOUNT_CODE_MESSAGE: Record<DiscountCodeFailure, string> = {
  [DISCOUNT_CODE_FAILURE.UNKNOWN]: 'That discount code does not exist.',
  [DISCOUNT_CODE_FAILURE.INACTIVE]: 'That discount code has been switched off.',
  [DISCOUNT_CODE_FAILURE.NOT_YET_VALID]: 'That discount code is not valid yet.',
  [DISCOUNT_CODE_FAILURE.EXPIRED]: 'That discount code has expired.',
  [DISCOUNT_CODE_FAILURE.EXHAUSTED]: 'That discount code has been fully redeemed.',
  [DISCOUNT_CODE_FAILURE.WRONG_BRANCH]: 'That discount code is not valid at this branch.',
  [DISCOUNT_CODE_FAILURE.ALREADY_USED]: 'This patient has already used that discount code.',
};

/**
 * Canonical stored form: uppercase, no surrounding space.
 *
 * Applied on every write AND every lookup, the way normalizePhone() is, so the
 * unique index is the real duplicate guard rather than a convention.
 */
export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** The shape isCodeValidAt() needs — structural, so tests need no database. */
export interface DiscountCodeRules {
  isActive: boolean | null;
  validFrom: Date | null;
  validUntil: Date | null;
  maxRedemptions: number | null;
  usedCount: number;
  branchId: string | null;
}

/**
 * Why this code cannot be used, or null when it can.
 *
 * `now` must come from clinicNow(), and validFrom/validUntil are naive clinic
 * wall clock read through their UTC fields — so all three share one
 * representation and comparing them is correct. Never compare these in SQL: the
 * MySQL server's own time_zone is not pinned anywhere in this repo, only the
 * driver's marshalling is (lib/db.ts).
 *
 * The window is HALF-OPEN, validFrom <= now < validUntil, matching endOfDay()'s
 * exclusive upper bound. A closed bound on '23:59:59' loses the last second.
 */
export function isCodeValidAt(
  code: DiscountCodeRules | null | undefined,
  options: { now: Date; branchId: string }
): DiscountCodeFailure | null {
  if (!code) return DISCOUNT_CODE_FAILURE.UNKNOWN;
  if (!code.isActive) return DISCOUNT_CODE_FAILURE.INACTIVE;

  const now = options.now.getTime();
  if (code.validFrom && now < code.validFrom.getTime()) {
    return DISCOUNT_CODE_FAILURE.NOT_YET_VALID;
  }
  if (code.validUntil && now >= code.validUntil.getTime()) {
    return DISCOUNT_CODE_FAILURE.EXPIRED;
  }

  // A null branchId means the code is valid everywhere.
  if (code.branchId && code.branchId !== options.branchId) {
    return DISCOUNT_CODE_FAILURE.WRONG_BRANCH;
  }

  // Advisory only — redeemDiscountCode() is what actually enforces the limit.
  if (code.maxRedemptions !== null && code.usedCount >= code.maxRedemptions) {
    return DISCOUNT_CODE_FAILURE.EXHAUSTED;
  }

  return null;
}

/** The printed line description, e.g. 'Discount code SUMMER20 (20%)'. */
export function discountCodeLabel(code: {
  code: string;
  description: string | null;
  discountType: string;
  discountValue: number;
}): string {
  const magnitude =
    code.discountType === DISCOUNT_TYPE.PERCENTAGE
      ? `${code.discountValue}%`
      : formatPKR(code.discountValue);
  const suffix = code.description ? ` — ${code.description}` : '';
  return `Discount code ${code.code} (${magnitude})${suffix}`;
}
