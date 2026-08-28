/**
 * Interval algebra over minutes-since-midnight.
 *
 * Everything the appointment book does — free slots, roster windows, time off,
 * double-booking — reduces to set operations on half-open ranges. Pure and
 * unit tested, because an off-by-one here is a double-booked chair.
 *
 * HALF-OPEN, always: [start, end). 09:00–09:30 and 09:30–10:00 are adjacent,
 * not overlapping. Comparisons use strict < and >, never <= or >=.
 */

export interface Interval {
  start: number;
  end: number;
}

/** Discards anything empty or inverted, so callers need not defend against it. */
function valid(interval: Interval): boolean {
  return (
    Number.isFinite(interval.start) &&
    Number.isFinite(interval.end) &&
    interval.end > interval.start
  );
}

export function isValidInterval(interval: Interval): boolean {
  return valid(interval);
}

export function duration(interval: Interval): number {
  return Math.max(0, interval.end - interval.start);
}

/** Do two intervals share any time at all? Touching endpoints do not count. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/**
 * Sort and coalesce. Adjacent intervals are joined: two back-to-back roster
 * blocks are one continuous window as far as booking is concerned.
 */
export function merge(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter(valid).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];

  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/** Time present in both sets. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = merge(a);
  const right = merge(b);
  const result: Interval[] = [];

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i]!.start, right[j]!.start);
    const end = Math.min(left[i]!.end, right[j]!.end);
    if (end > start) result.push({ start, end });

    // Advance whichever ends first; the other may still overlap what follows.
    if (left[i]!.end < right[j]!.end) i++;
    else j++;
  }

  return result;
}

/** Time in `from` that is not in `remove`. The workhorse of availability. */
export function subtract(
  from: readonly Interval[],
  remove: readonly Interval[]
): Interval[] {
  const base = merge(from);
  const cuts = merge(remove);
  const result: Interval[] = [];

  for (const interval of base) {
    let cursor = interval.start;

    for (const cut of cuts) {
      if (cut.end <= cursor) continue;      // entirely before what is left
      if (cut.start >= interval.end) break; // and the rest are beyond it

      if (cut.start > cursor) {
        result.push({ start: cursor, end: Math.min(cut.start, interval.end) });
      }
      cursor = Math.max(cursor, cut.end);
      if (cursor >= interval.end) break;
    }

    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }

  return result.filter(valid);
}

/** Total minutes covered, counting overlaps once. */
export function totalDuration(intervals: readonly Interval[]): number {
  return merge(intervals).reduce((sum, i) => sum + duration(i), 0);
}

/**
 * Walk each free window on a grid, emitting slots of `slotMinutes` that fit
 * ENTIRELY inside it.
 *
 * `granularity` is how far apart candidate start times are — typically the
 * clinic's slotMinutes (15), so appointments land on the quarter hour rather
 * than at whatever moment the previous one happened to end.
 */
export function generateSlots(
  windows: readonly Interval[],
  slotMinutes: number,
  granularity = slotMinutes
): Interval[] {
  if (slotMinutes <= 0 || granularity <= 0) return [];

  const slots: Interval[] = [];

  for (const window of merge(windows)) {
    // Round the first candidate up to the grid so slots stay aligned.
    let start = Math.ceil(window.start / granularity) * granularity;
    if (start < window.start) start += granularity;

    while (start + slotMinutes <= window.end) {
      slots.push({ start, end: start + slotMinutes });
      start += granularity;
    }
  }

  return slots;
}

/** Which of `candidates` collide with `busy`. */
export function findConflicts(
  candidate: Interval,
  busy: readonly Interval[]
): Interval[] {
  return busy.filter((b) => overlaps(candidate, b));
}

/** Is the whole candidate inside one of the allowed windows? */
export function isWithin(candidate: Interval, windows: readonly Interval[]): boolean {
  return merge(windows).some((w) => contains(w, candidate));
}
