/**
 * Date/time helpers for the clinic.
 *
 * CONVENTION: MySQL `DATETIME` columns hold NAIVE CLINIC-LOCAL WALL CLOCK.
 * An appointment at 09:00 is stored as 09:00 and means 09:00 at that branch,
 * with no offset attached.
 *
 * lib/db.ts pins the connection `timezone: 'Z'`, so mysql2 maps a DATETIME to
 * a JS Date whose UTC fields carry those wall-clock digits. Read them back
 * with the getUTC* accessors and you get 09:00 on every machine, regardless of
 * the server's own timezone.
 *
 * The rule that follows: NEVER use the local-time accessors on a value that
 * came from the database — getHours(), getDate(), toLocaleString(),
 * toDateString(), date-fns without a UTC config. On a Karachi user's browser
 * those shift everything by five hours. Format through the helpers here
 * instead; they are safe in both server and client components.
 *
 * `branches.timezone` (always CLINIC_TIMEZONE) is what a wall-clock reading
 * means in real terms. It matters when converting to a true instant — sending
 * a reminder, or comparing two branches — not for storing or displaying.
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The clinic's timezone. Pakistan Standard Time (UTC+5) — one zone nationwide,
 * so this covers Karachi, Islamabad, Lahore and every other branch location.
 * Pakistan does not observe daylight saving, so the offset never moves.
 *
 * This is the DEFAULT and the only supported value; `branches.timezone` exists
 * for future expansion but is seeded to this and should stay that way.
 */
export const CLINIC_TIMEZONE = 'Asia/Karachi' as const;

/** Timezones a branch may be set to. Deliberately a single-entry list. */
export const SUPPORTED_TIMEZONES = [CLINIC_TIMEZONE] as const;
export type SupportedTimezone = (typeof SUPPORTED_TIMEZONES)[number];

/** Milliseconds in a minute / day, for interval arithmetic. */
export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

/**
 * `staff_schedules.dayOfWeek` encoding: 0 = Sunday … 6 = Saturday.
 *
 * Chosen to match Date.getUTCDay() so the availability engine needs no
 * conversion. Independent of WEEK_STARTS_ON, which is only about display.
 */
export const DAY_OF_WEEK = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
} as const;

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Calendars render Monday-first: the clinic week is Mon–Sat with Sunday off. */
export const WEEK_STARTS_ON = DAY_OF_WEEK.MONDAY;

/** Day of week for a stored wall-clock value. Matches DAY_OF_WEEK above. */
export function dayOfWeek(d: Date): number {
  return d.getUTCDay();
}

/**
 * "Now", expressed as wall clock in the given timezone.
 *
 * Uses Intl to read the current instant's local parts, then rebuilds them as
 * UTC fields so the result compares directly against stored DATETIME values.
 * No dependency, correct across DST for timezones that observe it.
 */
export function clinicNow(timeZone: string = CLINIC_TIMEZONE): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = get('hour') % 24;

  return new Date(
    Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  );
}

/** Build a stored-wall-clock Date from calendar parts. Month is 1-based. */
export function fromClinicParts(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0
): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}

/** Midnight at the start of the day containing `d`. */
export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Midnight at the start of the NEXT day — an exclusive upper bound. */
export function endOfDay(d: Date): Date {
  return new Date(startOfDay(d).getTime() + DAY_MS);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MINUTE_MS);
}

/**
 * Add calendar months, clamping to the end of the target month.
 * 31 Jan + 1 month is 28 Feb, not 3 March. Recall due dates depend on this.
 */
export function addMonthsClamped(d: Date, months: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  const target = new Date(Date.UTC(year, month + months, 1));
  const lastDayOfTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();

  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(day, lastDayOfTarget),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds()
    )
  );
}

/** Minutes since midnight — the unit the availability engine works in. */
export function minutesSinceMidnight(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Turn minutes-since-midnight back into a Date on the given day. */
export function atMinutes(day: Date, minutes: number): Date {
  return new Date(startOfDay(day).getTime() + minutes * MINUTE_MS);
}

/** Parse 'HH:MM' (as stored in clinic_settings and staff_schedules) to minutes. */
export function parseHHMM(value: string): number {
  const m = HHMM.exec(value);
  if (!m) throw new Error(`Invalid HH:MM time: ${JSON.stringify(value)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Inverse of parseHHMM. */
export function toHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/* ── Formatting ──────────────────────────────────────────────────────────
 * All UTC-based, so a stored 09:00 renders as 09:00 everywhere. Safe to call
 * from client components.
 */

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** 'YYYY-MM-DD' — the canonical key for grouping by day and for URL params. */
export function toDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

/** Parse a 'YYYY-MM-DD' key back to midnight on that day. */
export function fromDateKey(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Invalid date key: ${JSON.stringify(key)}`);
  return fromClinicParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** '27 Aug 2026' */
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return '';
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** '9:05 AM' */
export function fmtTime(d: Date | null | undefined): string {
  if (!d) return '';
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** '27 Aug 2026, 9:05 AM' */
export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return '';
  return `${fmtDate(d)}, ${fmtTime(d)}`;
}

/** 'Thu 27 Aug' — compact calendar column heading. */
export function fmtDayLabel(d: Date): string {
  return `${DAY_NAMES[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** '1h 30m' / '45m' — for appointment durations and wait times. */
export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (!h) return `${rem}m`;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Age in whole years — shown next to a patient's name. */
export function ageFrom(dateOfBirth: Date | null | undefined, asOf?: Date): number | null {
  if (!dateOfBirth) return null;
  const now = asOf ?? clinicNow();
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

/**
 * Convert a stored wall-clock value to the true instant it represents in a
 * branch's timezone. Only needed when talking to the outside world — when a
 * reminder should actually be sent, or when comparing branches in different
 * zones. Never needed for storage or display.
 */
export function toInstant(wallClock: Date, timeZone: string): Date {
  // Read the wall-clock digits back as if they were in `timeZone`, by
  // measuring that zone's offset at approximately the right moment.
  const utcGuess = wallClock.getTime();
  const local = new Date(
    new Date(utcGuess).toLocaleString('en-US', { timeZone })
  ).getTime();
  const asUtc = new Date(new Date(utcGuess).toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return new Date(utcGuess + (asUtc - local));
}
