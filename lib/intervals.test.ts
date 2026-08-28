import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contains,
  duration,
  findConflicts,
  generateSlots,
  intersect,
  isWithin,
  merge,
  overlaps,
  subtract,
  totalDuration,
  type Interval,
} from './intervals.ts';

/** 'HH:MM' -> minutes, so the tests read like a clinic diary. */
const at = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
};
const span = (from: string, to: string): Interval => ({ start: at(from), end: at(to) });
const show = (intervals: Interval[]) =>
  intervals.map((i) => `${Math.floor(i.start / 60)}:${String(i.start % 60).padStart(2, '0')}`);

describe('overlaps — the half-open rule', () => {
  it('treats back-to-back appointments as NOT overlapping', () => {
    // The single most important rule here: 09:00-09:30 and 09:30-10:00 are
    // adjacent. Getting this wrong makes every consecutive booking a conflict.
    assert.equal(overlaps(span('09:00', '09:30'), span('09:30', '10:00')), false);
    assert.equal(overlaps(span('09:30', '10:00'), span('09:00', '09:30')), false);
  });

  it('detects a genuine clash', () => {
    assert.equal(overlaps(span('09:00', '10:00'), span('09:30', '10:30')), true);
    assert.equal(overlaps(span('09:00', '10:00'), span('09:15', '09:45')), true);
  });

  it('detects containment in both directions', () => {
    assert.equal(overlaps(span('09:00', '12:00'), span('10:00', '11:00')), true);
    assert.equal(overlaps(span('10:00', '11:00'), span('09:00', '12:00')), true);
  });

  it('is false for disjoint ranges', () => {
    assert.equal(overlaps(span('09:00', '10:00'), span('14:00', '15:00')), false);
  });
});

describe('merge', () => {
  it('sorts and coalesces overlapping ranges', () => {
    assert.deepEqual(merge([span('10:00', '11:00'), span('09:00', '10:30')]), [
      span('09:00', '11:00'),
    ]);
  });

  it('joins two adjacent roster blocks into one bookable window', () => {
    assert.deepEqual(merge([span('09:00', '13:00'), span('13:00', '17:00')]), [
      span('09:00', '17:00'),
    ]);
  });

  it('keeps a genuine gap — a split shift stays split', () => {
    const shifts = merge([span('09:00', '13:00'), span('14:00', '18:00')]);
    assert.equal(shifts.length, 2);
    assert.deepEqual(shifts, [span('09:00', '13:00'), span('14:00', '18:00')]);
  });

  it('discards empty and inverted input rather than trusting it', () => {
    assert.deepEqual(merge([{ start: 100, end: 100 }, { start: 200, end: 100 }]), []);
  });

  it('does not mutate its input', () => {
    const input = [span('09:00', '10:00'), span('09:30', '11:00')];
    const copy = structuredClone(input);
    merge(input);
    assert.deepEqual(input, copy);
  });
});

describe('subtract — the core of availability', () => {
  it('cuts an appointment out of the middle of a shift', () => {
    const free = subtract([span('09:00', '17:00')], [span('12:00', '13:00')]);
    assert.deepEqual(free, [span('09:00', '12:00'), span('13:00', '17:00')]);
  });

  it('trims from the start and the end', () => {
    assert.deepEqual(subtract([span('09:00', '17:00')], [span('09:00', '10:00')]), [
      span('10:00', '17:00'),
    ]);
    assert.deepEqual(subtract([span('09:00', '17:00')], [span('16:00', '17:00')]), [
      span('09:00', '16:00'),
    ]);
  });

  it('removes the window entirely when a full day off covers it', () => {
    assert.deepEqual(subtract([span('09:00', '17:00')], [span('00:00', '23:59')]), []);
  });

  it('handles several appointments in one day', () => {
    const free = subtract(
      [span('09:00', '17:00')],
      [span('09:30', '10:00'), span('11:00', '12:00'), span('15:00', '16:30')]
    );
    assert.deepEqual(free, [
      span('09:00', '09:30'),
      span('10:00', '11:00'),
      span('12:00', '15:00'),
      span('16:30', '17:00'),
    ]);
  });

  it('is unaffected by an appointment outside the shift', () => {
    assert.deepEqual(subtract([span('09:00', '17:00')], [span('18:00', '19:00')]), [
      span('09:00', '17:00'),
    ]);
  });

  it('copes with overlapping busy ranges', () => {
    const free = subtract([span('09:00', '17:00')], [span('10:00', '12:00'), span('11:00', '13:00')]);
    assert.deepEqual(free, [span('09:00', '10:00'), span('13:00', '17:00')]);
  });

  it('leaves adjacent busy ranges producing no spurious gap', () => {
    const free = subtract([span('09:00', '17:00')], [span('10:00', '11:00'), span('11:00', '12:00')]);
    assert.deepEqual(free, [span('09:00', '10:00'), span('12:00', '17:00')]);
  });

  it('subtracts across a split shift', () => {
    const free = subtract(
      [span('09:00', '13:00'), span('14:00', '18:00')],
      [span('12:00', '15:00')]
    );
    assert.deepEqual(free, [span('09:00', '12:00'), span('15:00', '18:00')]);
  });
});

describe('intersect', () => {
  it('keeps only what clinic hours and the roster agree on', () => {
    const clinic = [span('09:00', '21:00')];
    const roster = [span('08:00', '13:00')];
    assert.deepEqual(intersect(clinic, roster), [span('09:00', '13:00')]);
  });

  it('returns nothing when they do not overlap', () => {
    assert.deepEqual(intersect([span('09:00', '12:00')], [span('13:00', '17:00')]), []);
  });

  it('handles many ranges on both sides', () => {
    const result = intersect(
      [span('09:00', '12:00'), span('14:00', '18:00')],
      [span('11:00', '15:00'), span('17:00', '20:00')]
    );
    assert.deepEqual(result, [
      span('11:00', '12:00'),
      span('14:00', '15:00'),
      span('17:00', '18:00'),
    ]);
  });
});

describe('generateSlots', () => {
  it('fills a morning with 30-minute appointments on a 15-minute grid', () => {
    const slots = generateSlots([span('09:00', '10:00')], 30, 15);
    assert.deepEqual(show(slots), ['9:00', '9:15', '9:30']);
  });

  it('never emits a slot that runs past the window', () => {
    // A 45-minute procedure does not fit in the last half hour.
    const slots = generateSlots([span('09:00', '10:00')], 45, 15);
    assert.deepEqual(show(slots), ['9:00', '9:15']);
    assert.ok(slots.every((s) => s.end <= at('10:00')));
  });

  it('returns nothing when the window is shorter than the appointment', () => {
    assert.deepEqual(generateSlots([span('09:00', '09:20')], 30, 15), []);
  });

  it('aligns to the grid even when the window starts off it', () => {
    // A gap opening at 09:07 still offers 09:15, not 09:07.
    const slots = generateSlots([{ start: at('09:07'), end: at('10:00') }], 30, 15);
    assert.deepEqual(show(slots), ['9:15', '9:30']);
  });

  it('uses the slot length as the default granularity', () => {
    assert.deepEqual(show(generateSlots([span('09:00', '10:00')], 30)), ['9:00', '9:30']);
  });

  it('spans multiple free windows', () => {
    const slots = generateSlots([span('09:00', '09:30'), span('11:00', '11:30')], 30, 15);
    assert.deepEqual(show(slots), ['9:00', '11:00']);
  });

  it('refuses nonsensical parameters instead of looping', () => {
    assert.deepEqual(generateSlots([span('09:00', '17:00')], 0), []);
    assert.deepEqual(generateSlots([span('09:00', '17:00')], 30, 0), []);
  });
});

describe('conflict helpers', () => {
  it('finds only genuine clashes, not adjacencies', () => {
    const busy = [span('09:00', '09:30'), span('10:00', '11:00')];
    assert.equal(findConflicts(span('09:30', '10:00'), busy).length, 0);
    assert.deepEqual(findConflicts(span('09:15', '09:45'), busy), [span('09:00', '09:30')]);
  });

  it('isWithin requires the whole appointment to fit inside a window', () => {
    const roster = [span('09:00', '13:00')];
    assert.equal(isWithin(span('09:00', '10:00'), roster), true);
    assert.equal(isWithin(span('12:30', '13:30'), roster), false);
    // Not satisfied by straddling two separate windows.
    assert.equal(isWithin(span('12:30', '14:30'), [span('09:00', '13:00'), span('14:00', '18:00')]), false);
  });

  it('contains treats identical bounds as contained', () => {
    assert.equal(contains(span('09:00', '10:00'), span('09:00', '10:00')), true);
  });
});

describe('durations', () => {
  it('measures a single interval', () => {
    assert.equal(duration(span('09:00', '10:30')), 90);
  });

  it('counts overlapping time once', () => {
    assert.equal(totalDuration([span('09:00', '11:00'), span('10:00', '12:00')]), 180);
  });

  it('sums a split shift', () => {
    assert.equal(totalDuration([span('09:00', '13:00'), span('14:00', '18:00')]), 480);
  });
});
