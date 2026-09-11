import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyReschedule,
  applyStatusChange,
  applyStatusPath,
  canTransition,
  CLOSED_STATUSES,
  statusPath,
  waitingMinutes,
  waitSeverity,
} from './appointments.ts';
import { addMinutes, fromClinicParts } from './datetime.ts';

const now = fromClinicParts(2026, 8, 28, 10, 0);
const actorId = 'staff-1';

describe('appointment transitions', () => {
  it('follows the normal path through a visit', () => {
    assert.equal(canTransition('scheduled', 'confirmed'), true);
    assert.equal(canTransition('confirmed', 'checked_in'), true);
    assert.equal(canTransition('checked_in', 'in_progress'), true);
    assert.equal(canTransition('in_progress', 'completed'), true);
  });

  it('lets a walk-in skip confirmation', () => {
    assert.equal(canTransition('scheduled', 'checked_in'), true);
  });

  it('refuses to complete an appointment nobody checked in', () => {
    assert.equal(canTransition('scheduled', 'completed'), false);
    assert.equal(canTransition('confirmed', 'completed'), false);
  });

  it('does not resurrect a cancelled appointment', () => {
    // The desk rebooks instead, so the cancellation stays in the record and
    // in the reporting.
    assert.deepEqual(canTransition('cancelled', 'scheduled'), false);
    assert.deepEqual(canTransition('cancelled', 'checked_in'), false);
  });

  it('allows a mis-clicked no-show to be corrected', () => {
    assert.equal(canTransition('no_show', 'scheduled'), true);
    assert.equal(canTransition('no_show', 'checked_in'), true);
  });

  it('treats completed as terminal', () => {
    assert.equal(canTransition('completed', 'scheduled'), false);
    assert.equal(canTransition('completed', 'cancelled'), false);
  });

  it('rejects an unknown status rather than letting it through', () => {
    assert.equal(canTransition('nonsense', 'confirmed'), false);
    assert.equal(canTransition('scheduled', 'nonsense'), false);
  });
});

describe('applyStatusChange', () => {
  it('stamps confirmedAt on confirmation', () => {
    const patch = applyStatusChange({ from: 'scheduled', to: 'confirmed', now, actorId });
    assert.equal(patch.confirmedAt?.getTime(), now.getTime());
  });

  it('refuses a no-op self transition rather than restamping', () => {
    // Re-confirming an already-confirmed appointment is not a state change.
    // Routes short-circuit when the status is unchanged; letting it through
    // here would move confirmedAt on every retry or double-click.
    assert.throws(
      () => applyStatusChange({ from: 'confirmed', to: 'confirmed' as never, now, actorId }),
      /cannot become/
    );
  });

  it('backfills confirmedAt for a walk-in checking straight in', () => {
    // Otherwise the timeline has a hole and any duration report breaks.
    const patch = applyStatusChange({
      from: 'scheduled',
      to: 'checked_in',
      now,
      actorId,
      existing: { confirmedAt: null },
    });
    assert.equal(patch.checkedInAt?.getTime(), now.getTime());
    assert.equal(patch.confirmedAt?.getTime(), now.getTime());
  });

  it('backfills the whole sequence when completing directly from the chair', () => {
    const patch = applyStatusChange({
      from: 'checked_in',
      to: 'completed',
      now,
      actorId,
      existing: { confirmedAt: null, checkedInAt: null },
    });
    assert.equal(patch.completedAt?.getTime(), now.getTime());
    assert.equal(patch.checkedInAt?.getTime(), now.getTime());
    assert.equal(patch.confirmedAt?.getTime(), now.getTime());
  });

  it('preserves a real check-in time when completing', () => {
    const checkedIn = fromClinicParts(2026, 8, 28, 9, 45);
    const patch = applyStatusChange({
      from: 'in_progress',
      to: 'completed',
      now,
      actorId,
      existing: { checkedInAt: checkedIn, confirmedAt: checkedIn },
    });
    assert.equal(patch.checkedInAt?.getTime(), checkedIn.getTime());
    assert.equal(patch.completedAt?.getTime(), now.getTime());
  });

  it('records who cancelled, when, and why', () => {
    const patch = applyStatusChange({
      from: 'scheduled',
      to: 'cancelled',
      now,
      actorId,
      reason: 'Patient called to cancel',
    });
    assert.equal(patch.cancelledAt?.getTime(), now.getTime());
    assert.equal(patch.cancelledBy, actorId);
    assert.equal(patch.cancellationReason, 'Patient called to cancel');
  });

  it('sets ONLY the status for a no-show', () => {
    // There is no no-show column. Overloading cancelledAt/cancelledBy would
    // corrupt every cancellation report; audit_logs records who marked it.
    const patch = applyStatusChange({ from: 'scheduled', to: 'no_show', now, actorId });
    assert.equal(patch.status, 'no_show');
    assert.equal(patch.cancelledAt, undefined);
    assert.equal(patch.cancelledBy, undefined);
    assert.equal(patch.completedAt, undefined);
  });

  it('sets ONLY the status for in_progress', () => {
    // The linked visit's createdAt is when work actually started.
    const patch = applyStatusChange({ from: 'checked_in', to: 'in_progress', now, actorId });
    assert.equal(patch.status, 'in_progress');
    assert.equal(patch.checkedInAt, undefined);
    assert.equal(patch.completedAt, undefined);
  });

  it('clears the timestamps when a no-show is corrected back to scheduled', () => {
    const patch = applyStatusChange({ from: 'no_show', to: 'scheduled', now, actorId });
    assert.equal(patch.confirmedAt, null);
    assert.equal(patch.checkedInAt, null);
  });

  it('throws rather than performing an illegal transition', () => {
    assert.throws(
      () => applyStatusChange({ from: 'completed', to: 'scheduled', now, actorId }),
      /cannot become/
    );
  });
});

describe('applyReschedule', () => {
  it('clears reminderEmailSentAt so the new time is actually announced', () => {
    // Without this the "already reminded" guard suppresses the reminder for
    // the new slot, and the patient only ever hears about the old one.
    const patch = applyReschedule({
      startAt: fromClinicParts(2026, 9, 1, 14, 0),
      endAt: fromClinicParts(2026, 9, 1, 14, 30),
    });
    assert.equal(patch.reminderEmailSentAt, null);
  });

  it('returns the appointment to unconfirmed', () => {
    const patch = applyReschedule({
      startAt: fromClinicParts(2026, 9, 1, 14, 0),
      endAt: fromClinicParts(2026, 9, 1, 14, 30),
    });
    assert.equal(patch.status, 'scheduled');
    assert.equal(patch.confirmedAt, null);
  });

  it('only includes chair and dentist when they were given', () => {
    const withoutChair = applyReschedule({
      startAt: now,
      endAt: addMinutes(now, 30),
    });
    assert.equal('chairId' in withoutChair, false);

    const withChair = applyReschedule({
      startAt: now,
      endAt: addMinutes(now, 30),
      chairId: null,
    });
    assert.equal('chairId' in withChair, true);
    assert.equal(withChair.chairId, null);
  });
});

describe('the waiting queue', () => {
  it('measures how long someone has been waiting', () => {
    assert.equal(waitingMinutes(fromClinicParts(2026, 8, 28, 9, 30), now), 30);
    assert.equal(waitingMinutes(fromClinicParts(2026, 8, 28, 9, 55), now), 5);
  });

  it('never reports a negative wait', () => {
    assert.equal(waitingMinutes(fromClinicParts(2026, 8, 28, 10, 15), now), 0);
  });

  it('returns null for someone who has not checked in', () => {
    assert.equal(waitingMinutes(null, now), null);
  });

  it('escalates a long wait so it is visible at the desk', () => {
    assert.equal(waitSeverity(5), 'none');
    assert.equal(waitSeverity(15), 'warn');
    assert.equal(waitSeverity(29), 'warn');
    assert.equal(waitSeverity(30), 'urgent');
    assert.equal(waitSeverity(null), 'none');
  });
});

describe('CLOSED_STATUSES', () => {
  it('covers every way an appointment ends', () => {
    assert.deepEqual([...CLOSED_STATUSES].sort(), ['cancelled', 'completed', 'no_show']);
  });
});

describe('statusPath', () => {
  it('goes straight there when the hop is already legal', () => {
    assert.deepEqual(statusPath('checked_in', 'completed'), ['completed']);
    assert.deepEqual(statusPath('in_progress', 'completed'), ['completed']);
  });

  it('routes a forgotten check-in through checked_in', () => {
    // The front desk never pressed "check in", but the patient is in the
    // chair — the visit being completed is the proof.
    assert.deepEqual(statusPath('scheduled', 'completed'), ['checked_in', 'completed']);
    assert.deepEqual(statusPath('confirmed', 'completed'), ['checked_in', 'completed']);
  });

  it('lets a mis-clicked no-show reach completed', () => {
    assert.deepEqual(statusPath('no_show', 'completed'), ['checked_in', 'completed']);
  });

  it('returns an empty path when there is nothing to do', () => {
    assert.deepEqual(statusPath('completed', 'completed'), []);
  });

  it('finds no route out of a terminal status', () => {
    assert.equal(statusPath('cancelled', 'completed'), null);
    assert.equal(statusPath('completed', 'in_progress'), null);
  });

  it('never routes THROUGH cancelled to get somewhere else', () => {
    // Cancelled is terminal, so this holds by construction — pinned because a
    // future edit to APPOINTMENT_TRANSITIONS could quietly break it.
    for (const from of ['scheduled', 'confirmed', 'checked_in', 'in_progress', 'no_show']) {
      for (const to of ['completed', 'in_progress', 'checked_in'] as const) {
        const path = statusPath(from, to);
        if (path) assert.equal(path.includes('cancelled'), false, `${from} → ${to}`);
      }
    }
  });

  it('walks to in_progress the same way', () => {
    assert.deepEqual(statusPath('scheduled', 'in_progress'), ['checked_in', 'in_progress']);
    assert.deepEqual(statusPath('checked_in', 'in_progress'), ['in_progress']);
  });

  it('rejects an unknown status rather than letting it through', () => {
    assert.equal(statusPath('archived', 'completed'), null);
  });
});

describe('applyStatusPath', () => {
  it('leaves no holes in the timeline when check-in was skipped', () => {
    const patch = applyStatusPath({
      from: 'scheduled',
      path: ['checked_in', 'completed'],
      now,
      actorId,
      existing: { confirmedAt: null, checkedInAt: null },
    });

    assert.equal(patch.status, 'completed');
    assert.equal(patch.completedAt?.getTime(), now.getTime());
    assert.equal(patch.checkedInAt?.getTime(), now.getTime());
    assert.equal(patch.confirmedAt?.getTime(), now.getTime());
  });

  it('preserves a real check-in rather than restamping it', () => {
    const checkedInAt = addMinutes(now, -45);

    const patch = applyStatusPath({
      from: 'checked_in',
      path: ['completed'],
      now,
      actorId,
      existing: { confirmedAt: null, checkedInAt },
    });

    assert.equal(patch.checkedInAt?.getTime(), checkedInAt.getTime());
    assert.equal(patch.completedAt?.getTime(), now.getTime());
  });

  it('does not let the second hop overwrite what the first one stamped', () => {
    // checked_in stamps checkedInAt; completed must then see that value as
    // "existing" rather than stamping its own over the top. Both are `now`
    // here, so the guard is that the first hop's value survives at all.
    const patch = applyStatusPath({
      from: 'confirmed',
      path: ['checked_in', 'completed'],
      now,
      actorId,
      existing: { confirmedAt: addMinutes(now, -600), checkedInAt: null },
    });

    assert.equal(patch.confirmedAt?.getTime(), addMinutes(now, -600).getTime());
    assert.equal(patch.checkedInAt?.getTime(), now.getTime());
  });

  it('invents no timestamp for in_progress', () => {
    const patch = applyStatusPath({
      from: 'checked_in',
      path: ['in_progress'],
      now,
      actorId,
      existing: { confirmedAt: null, checkedInAt: now },
    });

    assert.equal(patch.status, 'in_progress');
    assert.equal(patch.completedAt, undefined);
  });

  it('is a no-op for an empty path', () => {
    const patch = applyStatusPath({ from: 'completed', path: [], now, actorId });
    assert.deepEqual(patch, { status: 'completed' });
  });
});
