import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPlanStatusChange,
  canTransition,
  isPricingLocked,
  PLAN_TRANSITIONS,
  wasProposed,
} from './treatment-plans.ts';
import { fromClinicParts } from './datetime.ts';

const now = fromClinicParts(2026, 8, 28, 10, 0);

describe('plan transitions', () => {
  it('follows the quote lifecycle', () => {
    assert.equal(canTransition('draft', 'proposed'), true);
    assert.equal(canTransition('proposed', 'accepted'), true);
    assert.equal(canTransition('accepted', 'in_progress'), true);
    assert.equal(canTransition('in_progress', 'completed'), true);
  });

  it('lets a proposed plan go back to draft for reworking', () => {
    assert.equal(canTransition('proposed', 'draft'), true);
  });

  it('refuses to skip acceptance', () => {
    // Work cannot start on a quote the patient never agreed to.
    assert.equal(canTransition('draft', 'in_progress'), false);
    assert.equal(canTransition('proposed', 'completed'), false);
  });

  it('treats completed, rejected and cancelled as terminal', () => {
    for (const terminal of ['completed', 'rejected', 'cancelled'] as const) {
      assert.deepEqual(PLAN_TRANSITIONS[terminal], []);
      assert.equal(canTransition(terminal, 'draft'), false);
      assert.equal(canTransition(terminal, 'accepted'), false);
    }
  });

  it('rejects an unknown status rather than allowing it through', () => {
    assert.equal(canTransition('nonsense', 'accepted'), false);
    assert.equal(canTransition('draft', 'nonsense'), false);
  });
});

describe('applyPlanStatusChange', () => {
  it('stamps proposedAt when a plan is put to the patient', () => {
    const patch = applyPlanStatusChange({ from: 'draft', to: 'proposed', now });
    assert.equal(patch.status, 'proposed');
    assert.equal(patch.proposedAt?.getTime(), now.getTime());
  });

  it('preserves the original proposal date on re-proposal', () => {
    const original = fromClinicParts(2026, 8, 1);
    const patch = applyPlanStatusChange({
      from: 'draft',
      to: 'proposed',
      now,
      existingProposedAt: original,
    });
    assert.equal(patch.proposedAt?.getTime(), original.getTime());
  });

  it('stamps both timestamps on acceptance', () => {
    const original = fromClinicParts(2026, 8, 1);
    const patch = applyPlanStatusChange({
      from: 'proposed',
      to: 'accepted',
      now,
      existingProposedAt: original,
      note: 'Agreed at the desk',
    });
    assert.equal(patch.acceptedAt?.getTime(), now.getTime());
    assert.equal(patch.proposedAt?.getTime(), original.getTime());
    assert.equal(patch.acceptedNote, 'Agreed at the desk');
  });

  it('backfills proposedAt when a plan is accepted without a recorded proposal', () => {
    // Otherwise the acceptance-rate report has no denominator for this plan.
    const patch = applyPlanStatusChange({
      from: 'proposed',
      to: 'accepted',
      now,
      existingProposedAt: null,
    });
    assert.equal(patch.proposedAt?.getTime(), now.getTime());
  });

  it('clears both timestamps when a plan returns to draft', () => {
    // The earlier proposal no longer stands once it is being reworked.
    const patch = applyPlanStatusChange({
      from: 'proposed',
      to: 'draft',
      now,
      existingProposedAt: fromClinicParts(2026, 8, 1),
    });
    assert.equal(patch.proposedAt, null);
    assert.equal(patch.acceptedAt, null);
  });

  it('records why a plan was cancelled or rejected', () => {
    const cancelled = applyPlanStatusChange({
      from: 'accepted',
      to: 'cancelled',
      now,
      reason: 'Patient moved abroad',
    });
    assert.equal(cancelled.cancelReason, 'Patient moved abroad');

    const rejected = applyPlanStatusChange({
      from: 'proposed',
      to: 'rejected',
      now,
      reason: 'Too expensive',
    });
    assert.equal(rejected.cancelReason, 'Too expensive');
  });

  it('throws rather than performing an illegal transition', () => {
    assert.throws(
      () => applyPlanStatusChange({ from: 'completed', to: 'draft', now }),
      /cannot become/
    );
  });
});

describe('isPricingLocked', () => {
  it('allows editing while the plan is still a quote', () => {
    assert.equal(isPricingLocked('draft'), false);
    assert.equal(isPricingLocked('proposed'), false);
  });

  it('locks pricing once the patient has accepted', () => {
    // Changing the numbers behind an accepted quote is a different quote;
    // amendments belong in a new plan so the agreed figure stays auditable.
    assert.equal(isPricingLocked('accepted'), true);
    assert.equal(isPricingLocked('in_progress'), true);
    assert.equal(isPricingLocked('completed'), true);
  });

  it('leaves a rejected or cancelled plan unlocked', () => {
    assert.equal(isPricingLocked('rejected'), false);
    assert.equal(isPricingLocked('cancelled'), false);
  });
});

describe('wasProposed', () => {
  it('counts a plan with a proposal date', () => {
    assert.equal(wasProposed({ proposedAt: now, status: 'accepted' }), true);
  });

  it('counts any plan past draft, even without the timestamp', () => {
    assert.equal(wasProposed({ proposedAt: null, status: 'accepted' }), true);
  });

  it('excludes a plan still being drafted', () => {
    assert.equal(wasProposed({ proposedAt: null, status: 'draft' }), false);
  });
});
