import { db } from '@/lib/db';
import {
  appointments,
  clinicSettings,
  staffSchedules,
  staffTimeOff,
} from '@/lib/schema';
import { BLOCKING_APPOINTMENT_STATUSES } from '@/lib/enums';
import {
  addDays,
  atMinutes,
  dayOfWeek,
  endOfDay,
  minutesSinceMidnight,
  parseHHMM,
  startOfDay,
  toDateKey,
} from '@/lib/datetime';
import {
  generateSlots,
  intersect,
  merge,
  subtract,
  type Interval,
} from '@/lib/intervals';
import { and, eq, gt, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';

/**
 * Who is free, and when.
 *
 *   clinic hours  ∩  the dentist's roster  −  time off  −  existing appointments
 *
 * Everything is computed in minutes-since-midnight per day, which is why the
 * interval algebra is pure and separately tested.
 */

/**
 * No appointment is assumed longer than this.
 *
 * Overlap is `existing.startAt < newEnd AND existing.endAt > newStart`, but
 * `endAt > x` cannot use an index alongside a range on startAt — so a naive
 * query scans every future row. Adding a lower bound of
 * (windowStart − MAX_APPOINTMENT_MINUTES) keeps the (chairId, startAt) and
 * (dentistId, startAt) indexes as range scans, at the cost of missing any
 * appointment longer than eight hours. Nothing in the seeded catalogue comes
 * close: the longest is 90 minutes.
 */
export const MAX_APPOINTMENT_MINUTES = 480;

export interface ClinicHours {
  workStartMinutes: number;
  workEndMinutes: number;
  slotMinutes: number;
}

/** The clinic_settings singleton. Its id is the literal 'default'. */
export async function getClinicHours(): Promise<ClinicHours> {
  const [row] = await db.select().from(clinicSettings).limit(1);
  return {
    workStartMinutes: parseHHMM(row?.workStartTime ?? '09:00'),
    workEndMinutes: parseHHMM(row?.workEndTime ?? '21:00'),
    slotMinutes: row?.slotMinutes ?? 15,
  };
}

export interface DayAvailability {
  date: string;
  /** Free windows, in minutes since midnight. */
  windows: Interval[];
  /** Occupied ranges, for shading the calendar. */
  busy: Interval[];
  /** Bookable start times of the requested length. */
  slots: { start: Date; end: Date }[];
  /**
   * True when the dentist has no roster rows at all and clinic hours were
   * assumed. The UI should say so — an assumed day is not a promise.
   */
  assumedHours: boolean;
}

export interface AvailabilityQuery {
  branchId: string;
  dentistId?: string | null;
  chairId?: string | null;
  from: Date;
  to: Date;
  durationMinutes: number;
  granularityMinutes?: number;
  /** Exclude an appointment being rescheduled, so it does not block itself. */
  excludeAppointmentId?: string | null;
}

/**
 * Bounded overlap predicate. See MAX_APPOINTMENT_MINUTES.
 */
function overlapWindow(from: Date, to: Date) {
  const lowerBound = new Date(from.getTime() - MAX_APPOINTMENT_MINUTES * 60_000);
  return and(
    gt(appointments.startAt, lowerBound),
    lt(appointments.startAt, to),
    gt(appointments.endAt, from)
  );
}

export async function getAvailability(query: AvailabilityQuery): Promise<DayAvailability[]> {
  const hours = await getClinicHours();
  const granularity = query.granularityMinutes ?? hours.slotMinutes;

  const rangeStart = startOfDay(query.from);
  const rangeEnd = endOfDay(query.to);

  // Roster and time off are per-staff; skip both when asking about a chair.
  const [roster, timeOff, booked] = await Promise.all([
    query.dentistId
      ? db
          .select({
            dayOfWeek: staffSchedules.dayOfWeek,
            startTime: staffSchedules.startTime,
            endTime: staffSchedules.endTime,
          })
          .from(staffSchedules)
          .where(
            and(
              eq(staffSchedules.staffId, query.dentistId),
              eq(staffSchedules.branchId, query.branchId),
              eq(staffSchedules.isActive, true)
            )
          )
      : Promise.resolve([]),

    query.dentistId
      ? db
          .select({ startDate: staffTimeOff.startDate, endDate: staffTimeOff.endDate })
          .from(staffTimeOff)
          .where(
            and(
              eq(staffTimeOff.staffId, query.dentistId),
              lt(staffTimeOff.startDate, rangeEnd),
              gt(staffTimeOff.endDate, rangeStart)
            )
          )
      : Promise.resolve([]),

    db
      .select({
        id: appointments.id,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.branchId, query.branchId),
          query.dentistId ? eq(appointments.dentistId, query.dentistId) : undefined,
          query.chairId ? eq(appointments.chairId, query.chairId) : undefined,
          // A cancelled or no-show appointment frees its slot.
          inArray(appointments.status, BLOCKING_APPOINTMENT_STATUSES as string[]),
          query.excludeAppointmentId
            ? ne(appointments.id, query.excludeAppointmentId)
            : undefined,
          overlapWindow(rangeStart, rangeEnd)
        )
      ),
  ]);

  const rosterByDay = new Map<number, Interval[]>();
  for (const shift of roster) {
    const day = shift.dayOfWeek;
    const interval = { start: parseHHMM(shift.startTime), end: parseHHMM(shift.endTime) };
    const existing = rosterByDay.get(day);
    // Several rows for one day is a split shift, not a mistake.
    if (existing) existing.push(interval);
    else rosterByDay.set(day, [interval]);
  }

  const hasRoster = roster.length > 0;
  const clinicWindow: Interval = {
    start: hours.workStartMinutes,
    end: hours.workEndMinutes,
  };

  const days: DayAvailability[] = [];

  for (let day = startOfDay(query.from); day <= startOfDay(query.to); day = addDays(day, 1)) {
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);
    const weekday = dayOfWeek(day);

    /*
     * No roster rows at all means the dentist has never been scheduled. The
     * live database has ZERO staff_schedules rows, so a strict reading would
     * make the entire calendar unbookable on day one. Fall back to clinic
     * hours and flag it, rather than showing an empty diary that looks broken.
     */
    let base: Interval[];
    let assumedHours = false;

    if (!query.dentistId) {
      base = [clinicWindow];
    } else if (!hasRoster) {
      base = [clinicWindow];
      assumedHours = true;
    } else {
      base = intersect([clinicWindow], merge(rosterByDay.get(weekday) ?? []));
    }

    // Time off is stored as datetime ranges, so a half day works naturally.
    const offToday: Interval[] = [];
    for (const off of timeOff) {
      if (off.endDate <= dayStart || off.startDate >= dayEnd) continue;
      offToday.push({
        start: off.startDate <= dayStart ? 0 : minutesSinceMidnight(off.startDate),
        end: off.endDate >= dayEnd ? 1440 : minutesSinceMidnight(off.endDate),
      });
    }

    const busyToday: Interval[] = [];
    for (const appointment of booked) {
      if (appointment.endAt <= dayStart || appointment.startAt >= dayEnd) continue;
      busyToday.push({
        start: appointment.startAt <= dayStart ? 0 : minutesSinceMidnight(appointment.startAt),
        end: appointment.endAt >= dayEnd ? 1440 : minutesSinceMidnight(appointment.endAt),
      });
    }

    const windows = subtract(base, [...offToday, ...busyToday]);
    const slotIntervals = generateSlots(windows, query.durationMinutes, granularity);

    days.push({
      date: toDateKey(day),
      windows,
      busy: merge(busyToday),
      slots: slotIntervals.map((slot) => ({
        start: atMinutes(day, slot.start),
        end: atMinutes(day, slot.end),
      })),
      assumedHours,
    });
  }

  return days;
}

/* ── Conflict detection ──────────────────────────────────────────────── */

export interface ConflictCheck {
  branchId: string;
  dentistId: string;
  chairId?: string | null;
  startAt: Date;
  endAt: Date;
  excludeAppointmentId?: string | null;
}

export interface ConflictResult {
  /** Hard clashes. These block the booking unless explicitly overridden. */
  dentistConflicts: { id: string; startAt: Date; endAt: Date }[];
  chairConflicts: { id: string; startAt: Date; endAt: Date }[];
  /** Soft warnings. A clinic really does book emergencies at 21:30. */
  outsideClinicHours: boolean;
  outsideRoster: boolean;
  duringTimeOff: boolean;
  blocking: boolean;
}

/**
 * Does this booking clash?
 *
 * MySQL has no exclusion constraint, so this is the only thing preventing a
 * double-booked chair. Callers must run it INSIDE the booking transaction —
 * checking beforehand and inserting afterwards leaves a window in which
 * another booking lands.
 *
 * A null chairId never conflicts: an unassigned appointment occupies no chair
 * by definition.
 */
export async function checkConflicts(
  check: ConflictCheck,
  tx: Pick<typeof db, 'select'> = db
): Promise<ConflictResult> {
  const hours = await getClinicHours();

  const notItself = check.excludeAppointmentId
    ? ne(appointments.id, check.excludeAppointmentId)
    : undefined;

  const window = and(
    gt(appointments.startAt, new Date(check.startAt.getTime() - MAX_APPOINTMENT_MINUTES * 60_000)),
    lt(appointments.startAt, check.endAt),
    gt(appointments.endAt, check.startAt),
    inArray(appointments.status, BLOCKING_APPOINTMENT_STATUSES as string[]),
    notItself
  );

  const [dentistConflicts, chairConflicts, timeOff] = await Promise.all([
    tx
      .select({ id: appointments.id, startAt: appointments.startAt, endAt: appointments.endAt })
      .from(appointments)
      .where(and(eq(appointments.dentistId, check.dentistId), window)),

    check.chairId
      ? tx
          .select({ id: appointments.id, startAt: appointments.startAt, endAt: appointments.endAt })
          .from(appointments)
          .where(and(eq(appointments.chairId, check.chairId), window))
      : Promise.resolve([]),

    db
      .select({ id: staffTimeOff.id })
      .from(staffTimeOff)
      .where(
        and(
          eq(staffTimeOff.staffId, check.dentistId),
          lt(staffTimeOff.startDate, check.endAt),
          gt(staffTimeOff.endDate, check.startAt)
        )
      )
      .limit(1),
  ]);

  const startMinutes = minutesSinceMidnight(check.startAt);
  const endMinutes = minutesSinceMidnight(check.endAt);
  const outsideClinicHours =
    startMinutes < hours.workStartMinutes || endMinutes > hours.workEndMinutes;

  const roster = await db
    .select({ startTime: staffSchedules.startTime, endTime: staffSchedules.endTime })
    .from(staffSchedules)
    .where(
      and(
        eq(staffSchedules.staffId, check.dentistId),
        eq(staffSchedules.branchId, check.branchId),
        eq(staffSchedules.dayOfWeek, dayOfWeek(check.startAt)),
        eq(staffSchedules.isActive, true)
      )
    );

  // With no roster configured we cannot say the booking is outside it.
  const outsideRoster =
    roster.length > 0 &&
    !roster.some(
      (shift) =>
        parseHHMM(shift.startTime) <= startMinutes && endMinutes <= parseHHMM(shift.endTime)
    );

  return {
    dentistConflicts,
    chairConflicts,
    outsideClinicHours,
    outsideRoster,
    duringTimeOff: timeOff.length > 0,
    blocking: dentistConflicts.length > 0 || chairConflicts.length > 0,
  };
}

/** Human-readable warnings for the soft cases. */
export function describeWarnings(result: ConflictResult): string[] {
  const warnings: string[] = [];
  if (result.outsideClinicHours) warnings.push('Outside the clinic’s opening hours.');
  if (result.outsideRoster) warnings.push('Outside this dentist’s working hours.');
  if (result.duringTimeOff) warnings.push('This dentist is on leave.');
  return warnings;
}
