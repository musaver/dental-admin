/**
 * Tests for lib/datetime.ts — run on Node's built-in test runner.
 *
 *   npm test
 *
 * No test framework dependency: Node 24 runs TypeScript natively and ships
 * `node:test`. The application itself is untouched Next.js.
 *
 * The suite runs twice, under TZ=UTC and TZ=Asia/Karachi — the two timezones
 * that actually occur in this project. Vercel's servers run UTC; the clinic
 * (and a developer's machine) runs Asia/Karachi, which is Pakistan Standard
 * Time and covers Karachi and Islamabad alike. Identical results under both is
 * the whole point of the naive-wall-clock convention.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  addMinutes,
  addMonthsClamped,
  ageFrom,
  atMinutes,
  DAY_OF_WEEK,
  dayOfWeek,
  endOfDay,
  fmtDate,
  fmtDateTime,
  fmtDayLabel,
  fmtDuration,
  fmtTime,
  fromClinicParts,
  fromDateKey,
  minutesSinceMidnight,
  parseHHMM,
  startOfDay,
  toDateKey,
  toHHMM,
} from './datetime.ts';

describe('wall-clock storage convention', () => {
  it('reads back the digits it was given, whatever the host timezone', () => {
    const d = fromClinicParts(2026, 8, 27, 9, 0);
    assert.equal(d.getUTCHours(), 9);
    assert.equal(d.getUTCMinutes(), 0);
    assert.equal(d.getUTCDate(), 27);
    assert.equal(d.getUTCMonth(), 7); // 0-based
  });

  it('formats a 09:00 appointment as 9:00 AM under any server timezone', () => {
    // This is the regression the timezone:'Z' pool setting exists to prevent.
    const appointment = fromClinicParts(2026, 8, 27, 9, 0);
    assert.equal(fmtTime(appointment), '9:00 AM');
    assert.equal(fmtDate(appointment), '27 Aug 2026');
    assert.equal(fmtDateTime(appointment), '27 Aug 2026, 9:00 AM');
  });
});

describe('dayOfWeek', () => {
  it('uses 0 = Sunday, matching the staff_schedules encoding', () => {
    // 2026-08-30 is a Sunday.
    assert.equal(dayOfWeek(fromClinicParts(2026, 8, 30)), DAY_OF_WEEK.SUNDAY);
    assert.equal(dayOfWeek(fromClinicParts(2026, 8, 31)), DAY_OF_WEEK.MONDAY);
    assert.equal(dayOfWeek(fromClinicParts(2026, 8, 29)), DAY_OF_WEEK.SATURDAY);
  });
});

describe('day boundaries', () => {
  it('startOfDay strips the time', () => {
    const d = startOfDay(fromClinicParts(2026, 8, 27, 14, 37, 12));
    assert.equal(toDateKey(d), '2026-08-27');
    assert.equal(minutesSinceMidnight(d), 0);
  });

  it('endOfDay is the exclusive next midnight', () => {
    const d = endOfDay(fromClinicParts(2026, 8, 27, 14, 0));
    assert.equal(toDateKey(d), '2026-08-28');
    assert.equal(minutesSinceMidnight(d), 0);
  });
});

describe('addMonthsClamped', () => {
  it('clamps 31 Jan + 1 month to 28 Feb in a non-leap year', () => {
    assert.equal(toDateKey(addMonthsClamped(fromClinicParts(2026, 1, 31), 1)), '2026-02-28');
  });

  it('clamps to 29 Feb in a leap year', () => {
    assert.equal(toDateKey(addMonthsClamped(fromClinicParts(2028, 1, 31), 1)), '2028-02-29');
  });

  it('handles the ordinary case and rolls the year over', () => {
    assert.equal(toDateKey(addMonthsClamped(fromClinicParts(2026, 8, 27), 6)), '2027-02-27');
  });

  it('preserves the time of day', () => {
    assert.equal(fmtTime(addMonthsClamped(fromClinicParts(2026, 1, 31, 14, 30), 1)), '2:30 PM');
  });

  it('supports a 1-month recall without drifting (Ortho Adjustment)', () => {
    // defaultRecallMonths = 1 on the seeded Ortho Adjustment procedure.
    assert.equal(toDateKey(addMonthsClamped(fromClinicParts(2026, 1, 31), 1)), '2026-02-28');
  });
});

describe('HH:MM parsing', () => {
  it('round-trips the seeded clinic work hours', () => {
    assert.equal(parseHHMM('09:00'), 540);
    assert.equal(parseHHMM('21:00'), 1260);
    assert.equal(toHHMM(540), '09:00');
    assert.equal(toHHMM(1260), '21:00');
  });

  it('accepts the boundaries', () => {
    assert.equal(parseHHMM('00:00'), 0);
    assert.equal(parseHHMM('23:59'), 1439);
  });

  it('rejects malformed input rather than silently coercing', () => {
    for (const bad of ['9:00', '24:00', '09:60', '', 'abc', '09-00']) {
      assert.throws(() => parseHHMM(bad), `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe('slot arithmetic', () => {
  it('atMinutes places a slot on the right day', () => {
    const slot = atMinutes(fromClinicParts(2026, 8, 27), 9 * 60 + 15);
    assert.equal(fmtTime(slot), '9:15 AM');
    assert.equal(toDateKey(slot), '2026-08-27');
  });

  it('minutesSinceMidnight inverts atMinutes', () => {
    const day = fromClinicParts(2026, 8, 27);
    for (const m of [0, 540, 555, 1260, 1439]) {
      assert.equal(minutesSinceMidnight(atMinutes(day, m)), m);
    }
  });

  it('addMinutes crosses a day boundary correctly', () => {
    const d = addMinutes(fromClinicParts(2026, 8, 27, 23, 45), 30);
    assert.equal(toDateKey(d), '2026-08-28');
    assert.equal(fmtTime(d), '12:15 AM');
  });

  it('addDays crosses a month boundary', () => {
    assert.equal(toDateKey(addDays(fromClinicParts(2026, 8, 31), 1)), '2026-09-01');
  });
});

describe('date keys', () => {
  it('round-trips', () => {
    const d = fromClinicParts(2026, 8, 27);
    assert.equal(toDateKey(fromDateKey(toDateKey(d))), '2026-08-27');
  });

  it('zero-pads', () => {
    assert.equal(toDateKey(fromClinicParts(2026, 1, 5)), '2026-01-05');
  });

  it('rejects malformed keys', () => {
    for (const bad of ['2026-8-27', '26-08-27', 'today', '']) {
      assert.throws(() => fromDateKey(bad), `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe('formatting', () => {
  it('handles noon and midnight', () => {
    assert.equal(fmtTime(fromClinicParts(2026, 8, 27, 0, 0)), '12:00 AM');
    assert.equal(fmtTime(fromClinicParts(2026, 8, 27, 12, 0)), '12:00 PM');
    assert.equal(fmtTime(fromClinicParts(2026, 8, 27, 13, 5)), '1:05 PM');
  });

  it('returns an empty string for null rather than "Invalid Date"', () => {
    assert.equal(fmtTime(null), '');
    assert.equal(fmtDate(undefined), '');
    assert.equal(fmtDateTime(null), '');
  });

  it('fmtDayLabel is compact', () => {
    assert.equal(fmtDayLabel(fromClinicParts(2026, 8, 27)), 'Thu 27 Aug');
  });

  it('fmtDuration reads naturally', () => {
    assert.equal(fmtDuration(15), '15m');
    assert.equal(fmtDuration(60), '1h');
    assert.equal(fmtDuration(90), '1h 30m');
    assert.equal(fmtDuration(0), '0m');
    assert.equal(fmtDuration(-5), '0m');
  });
});

describe('ageFrom', () => {
  const asOf = fromClinicParts(2026, 8, 27);

  it('computes whole years', () => {
    assert.equal(ageFrom(fromClinicParts(1990, 8, 27), asOf), 36);
  });

  it('does not count a birthday that has not happened yet', () => {
    assert.equal(ageFrom(fromClinicParts(1990, 8, 28), asOf), 35);
    assert.equal(ageFrom(fromClinicParts(1990, 12, 1), asOf), 35);
  });

  it('counts a birthday earlier in the year', () => {
    assert.equal(ageFrom(fromClinicParts(1990, 1, 1), asOf), 36);
  });

  it('returns null for a missing date of birth', () => {
    assert.equal(ageFrom(null, asOf), null);
  });
});
