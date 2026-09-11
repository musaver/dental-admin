import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DISCOUNT_CODE_FAILURE,
  discountCodeLabel,
  isCodeValidAt,
  normalizeDiscountCode,
  type DiscountCodeRules,
} from './discount-code-rules.ts';
import { endOfDay, fromClinicParts } from './datetime.ts';

/** A code with no restrictions at all; each test narrows what it needs. */
const usable = (over: Partial<DiscountCodeRules> = {}): DiscountCodeRules => ({
  isActive: true,
  validFrom: null,
  validUntil: null,
  maxRedemptions: null,
  usedCount: 0,
  branchId: null,
  ...over,
});

const BRANCH = 'branch-main';
const at = (y: number, m: number, d: number) => fromClinicParts(y, m, d);

describe('normalizeDiscountCode', () => {
  it('uppercases and trims, so the unique index is the real guard', () => {
    assert.equal(normalizeDiscountCode('  summer20 '), 'SUMMER20');
    assert.equal(normalizeDiscountCode('SuMmEr20'), 'SUMMER20');
    assert.equal(normalizeDiscountCode('SUMMER20'), 'SUMMER20');
  });
});

describe('isCodeValidAt', () => {
  const now = at(2026, 9, 15);

  it('accepts an unrestricted, active code', () => {
    assert.equal(isCodeValidAt(usable(), { now, branchId: BRANCH }), null);
  });

  it('rejects a code that does not exist', () => {
    assert.equal(
      isCodeValidAt(null, { now, branchId: BRANCH }),
      DISCOUNT_CODE_FAILURE.UNKNOWN
    );
  });

  it('rejects a switched-off code', () => {
    assert.equal(
      isCodeValidAt(usable({ isActive: false }), { now, branchId: BRANCH }),
      DISCOUNT_CODE_FAILURE.INACTIVE
    );
  });

  it('rejects a code whose window has not opened', () => {
    assert.equal(
      isCodeValidAt(usable({ validFrom: at(2026, 10, 1) }), { now, branchId: BRANCH }),
      DISCOUNT_CODE_FAILURE.NOT_YET_VALID
    );
  });

  it('rejects an expired code', () => {
    assert.equal(
      isCodeValidAt(usable({ validUntil: at(2026, 9, 1) }), { now, branchId: BRANCH }),
      DISCOUNT_CODE_FAILURE.EXPIRED
    );
  });

  it('rejects a code belonging to another branch, but not a global one', () => {
    assert.equal(
      isCodeValidAt(usable({ branchId: 'branch-other' }), { now, branchId: BRANCH }),
      DISCOUNT_CODE_FAILURE.WRONG_BRANCH
    );
    assert.equal(isCodeValidAt(usable({ branchId: null }), { now, branchId: BRANCH }), null);
    assert.equal(isCodeValidAt(usable({ branchId: BRANCH }), { now, branchId: BRANCH }), null);
  });

  it('rejects a fully redeemed code but allows the last use', () => {
    assert.equal(
      isCodeValidAt(usable({ maxRedemptions: 5, usedCount: 5 }), { now, branchId: BRANCH }),
      DISCOUNT_CODE_FAILURE.EXHAUSTED
    );
    assert.equal(
      isCodeValidAt(usable({ maxRedemptions: 5, usedCount: 4 }), { now, branchId: BRANCH }),
      null
    );
  });

  describe('the window is half-open, and timezone-independent', () => {
    // A code authored to run "through 30 September" stores endOfDay(30 Sep),
    // which is midnight entering 1 October — an EXCLUSIVE upper bound.
    const code = usable({
      validFrom: at(2026, 9, 1),
      validUntil: endOfDay(at(2026, 9, 30)),
    });

    it('is usable on the first day', () => {
      assert.equal(isCodeValidAt(code, { now: at(2026, 9, 1), branchId: BRANCH }), null);
    });

    it('is still usable in the last second of the last day', () => {
      const lastSecond = new Date(endOfDay(at(2026, 9, 30)).getTime() - 1000);
      assert.equal(isCodeValidAt(code, { now: lastSecond, branchId: BRANCH }), null);
    });

    it('has expired the instant the next day begins', () => {
      assert.equal(
        isCodeValidAt(code, { now: at(2026, 10, 1), branchId: BRANCH }),
        DISCOUNT_CODE_FAILURE.EXPIRED
      );
    });

    it('is not yet valid the day before it opens', () => {
      assert.equal(
        isCodeValidAt(code, { now: at(2026, 8, 31), branchId: BRANCH }),
        DISCOUNT_CODE_FAILURE.NOT_YET_VALID
      );
    });
  });
});

describe('discountCodeLabel', () => {
  it('names the code and its magnitude', () => {
    assert.equal(
      discountCodeLabel({
        code: 'SUMMER20',
        description: null,
        discountType: 'percentage',
        discountValue: 20,
      }),
      'Discount code SUMMER20 (20%)'
    );
  });

  it('renders a fixed amount as whole rupees', () => {
    assert.equal(
      discountCodeLabel({
        code: 'GOODWILL',
        description: 'Ramadan campaign',
        discountType: 'fixed',
        discountValue: 2500,
      }),
      'Discount code GOODWILL (Rs. 2,500) — Ramadan campaign'
    );
  });
});
