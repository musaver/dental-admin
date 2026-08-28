/**
 * The appointment diary and the recall list.
 *
 * Two invariants shape everything here:
 *
 * 1. No double-booking. The app hard-blocks overlapping appointments on the
 *    same chair and on the same dentist, so this module keeps its own busy
 *    lists and rejects any candidate slot that overlaps one. Intervals are
 *    half-open: 09:00-09:30 and 09:30-10:00 are fine. Cancelled and no-show
 *    appointments release their slot and are therefore never added — that is
 *    BLOCKING_APPOINTMENT_STATUSES, reproduced.
 *
 * 2. Status and its parallel timestamps are written together, the way
 *    applyStatusChange() writes them. A no-show is status only; overloading
 *    cancelledAt would invent a second meaning for that column.
 */
import {
  uuid,
  int,
  pick,
  pickN,
  chance,
  weighted,
  shuffle,
  TODAY,
  day,
  at,
  plusMinutes,
  plusDays,
  plusMonths,
  isClinicDay,
  dt,
  dateOnly,
} from './context.mjs';

/* ── Vocabularies (copied literals — lib/ is TypeScript) ──────────────── */

const STATUS_SCHEDULED = 'scheduled';
const STATUS_CONFIRMED = 'confirmed';
const STATUS_CHECKED_IN = 'checked_in';
const STATUS_IN_PROGRESS = 'in_progress';
const STATUS_COMPLETED = 'completed';
const STATUS_CANCELLED = 'cancelled';
const STATUS_NO_SHOW = 'no_show';

/** Everything except cancelled and no_show occupies its slot. */
const BLOCKING = new Set([
  STATUS_SCHEDULED,
  STATUS_CONFIRMED,
  STATUS_CHECKED_IN,
  STATUS_IN_PROGRESS,
  STATUS_COMPLETED,
]);

const TYPE_CONSULTATION = 'consultation';
const TYPE_PROCEDURE = 'procedure';
const TYPE_CHECKUP = 'checkup';
const TYPE_EMERGENCY = 'emergency';
const TYPE_FOLLOW_UP = 'follow_up';

const RECALL_PENDING = 'pending';
const RECALL_CONTACTED = 'contacted';
const RECALL_BOOKED = 'booked';
const RECALL_COMPLETED = 'completed';
const RECALL_CANCELLED = 'cancelled';

const PLAN_LINKABLE = new Set(['accepted', 'in_progress', 'completed']);

/* ── Clinic hours ─────────────────────────────────────────────────────── */

const OPEN_MIN = 9 * 60;
const LAST_START_MIN = 20 * 60 + 30;
const CLOSE_MIN = 21 * 60;
const SLOT_MIN = 15;

/* ── Copy for the diary ───────────────────────────────────────────────── */

const REASONS = {
  [TYPE_CONSULTATION]: [
    'New patient, upper right sensitivity for two weeks.',
    'Second opinion on an extraction advised elsewhere.',
    'Wants to discuss options for the missing lower molar.',
    'Referred by a relative, general assessment.',
  ],
  [TYPE_CHECKUP]: [
    'Routine check and scale.',
    'Six-month review, previous restorations to be checked.',
    'Bleeding gums on brushing, review with scaling.',
    'Child due for a check, mother reports night grinding.',
  ],
  [TYPE_PROCEDURE]: [
    'Continue RCT 36, second visit.',
    'Composite 16 MOD, patient prefers a morning slot.',
    'Crown prep 26, shade taken at the last visit.',
    'Full-mouth scaling, heavy calculus lower anteriors.',
    'Cementation of the zirconia crown, lab work is back.',
    'Extraction 48, patient warned about post-op swelling.',
  ],
  [TYPE_EMERGENCY]: [
    'Severe pain 46, swelling since last night.',
    'Fractured 11 after a fall, needs a same-day build-up.',
    'Post-extraction bleeding, patient walked in.',
    'Acute pain lower left, unable to sleep.',
    'Crown came off 25, patient has it with them.',
  ],
  [TYPE_FOLLOW_UP]: [
    'Post-extraction review 48, check healing.',
    'Crown fit check, 26.',
    'Review after the RCT dressing, patient reports comfort.',
    'Ortho adjustment review, wire irritating the cheek.',
  ],
};

const CANCELLATION_REASONS = [
  'Patient travelling, will call to rebook.',
  'Rescheduled at the patient request.',
  'Dentist called away to an emergency.',
  'Patient unwell.',
  'Double booking corrected at the front desk.',
  'Deferred to next month for financial reasons.',
  'Patient could not arrange transport.',
];

/* ── Small time helpers ───────────────────────────────────────────────── */

const atMin = (base, minutes) => at(base, Math.floor(minutes / 60), minutes % 60);
const ms = (d) => d.getTime();
const earliest = (...dates) => new Date(Math.min(...dates.map(ms)));
const latest = (...dates) => new Date(Math.max(...dates.map(ms)));

/** Patients may arrive with a Date or an already-formatted naive string. */
function createdOn(patient) {
  const raw = patient.createdAtDate ?? patient.createdAt ?? null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'string') return new Date(`${raw.slice(0, 10)}T${raw.slice(11, 19) || '00:00:00'}Z`);
  return day(-400);
}

export default function build(world, rows) {
  const patients = world.patients ?? [];
  const staff = world.staff ?? [];
  const chairs = world.chairs ?? [];

  const clinical = staff.filter((s) => s.isClinical === true && s.isActive !== false);
  if (!patients.length || !clinical.length) return;

  const owner = staff.find((s) => s.staffType === 'owner') ?? clinical[0];

  /* ── Per-branch resource pools ─────────────────────────────────────── */

  const dentistCache = new Map();
  function dentistsFor(branchId) {
    if (!dentistCache.has(branchId)) {
      // A null branchId is head office — the owner works at either branch.
      dentistCache.set(
        branchId,
        clinical.filter((s) => s.branchId === branchId || s.branchId == null)
      );
    }
    return dentistCache.get(branchId);
  }

  const chairCache = new Map();
  function chairsFor(branchId) {
    if (!chairCache.has(branchId)) {
      chairCache.set(branchId, chairs.filter((c) => c.branchId === branchId));
    }
    return chairCache.get(branchId);
  }

  const bookerCache = new Map();
  function bookersFor(branchId) {
    if (!bookerCache.has(branchId)) {
      const desk = staff.filter(
        (s) => s.branchId === branchId && s.isActive !== false && s.staffType === 'receptionist'
      );
      // The front desk books most of it; the owner books the rest.
      bookerCache.set(branchId, desk.length ? [...desk, ...desk, owner] : [owner]);
    }
    return bookerCache.get(branchId);
  }

  /* ── Busy lists — the double-booking guard ─────────────────────────── */

  const chairBusy = new Map();
  const dentistBusy = new Map();
  // Not an application rule, but a patient sitting in two chairs at once reads
  // as a bug in the demo, so the slot search avoids it too.
  const patientBusy = new Map();

  function isFree(map, key, start, end) {
    if (!key) return true;
    const list = map.get(key);
    if (!list) return true;
    const s = ms(start);
    const e = ms(end);
    // Half-open: touching endpoints do not overlap.
    return !list.some((b) => s < b.end && b.start < e);
  }

  function occupy(map, key, start, end) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ start: ms(start), end: ms(end) });
  }

  /* ── Leave ─────────────────────────────────────────────────────────── */

  // 01-org registers staff_time_off on `world` precisely so the diary can
  // avoid booking someone who is away. lib/availability.ts subtracts these
  // windows, so an appointment sitting inside one is a slot the availability
  // engine says does not exist — it reads as a bug on the rota screen.
  const leaveByStaff = new Map();
  for (const off of world.timeOff ?? []) {
    if (!leaveByStaff.has(off.staffId)) leaveByStaff.set(off.staffId, []);
    leaveByStaff.get(off.staffId).push({ start: ms(off.start), end: ms(off.end) });
  }

  function isAway(staffId, start, end) {
    const windows = leaveByStaff.get(staffId);
    if (!windows) return false;
    const s = ms(start);
    const e = ms(end);
    // Half-open, like every other overlap test here.
    return windows.some((w) => s < w.end && w.start < e);
  }

  /* ── Patient eligibility ───────────────────────────────────────────── */

  const byCreation = [...patients]
    .map((p) => ({ patient: p, created: createdOn(p) }))
    .sort((a, b) => ms(a.created) - ms(b.created));
  let creationCursor = 0;
  const eligible = [];

  /** Everyone registered before this calendar day opened. */
  function admitPatientsFor(dayDate) {
    const cutoff = ms(dayDate);
    while (creationCursor < byCreation.length && ms(byCreation[creationCursor].created) <= cutoff) {
      eligible.push(byCreation[creationCursor]);
      creationCursor += 1;
    }
  }

  /* ── Row construction ──────────────────────────────────────────────── */

  const appointments = [];

  function pushAppointment(fields) {
    const {
      patient,
      dentist,
      chair,
      start,
      end,
      type,
      status,
      isWalkIn = false,
      reasonNote = null,
      createdAt,
      confirmedAt = null,
      checkedInAt = null,
      completedAt = null,
      cancelledAt = null,
      cancellationReason = null,
      cancelledBy = null,
      reminderEmailSentAt = null,
    } = fields;

    const id = uuid();
    const branchId = patient.branchId;
    const createdBy = pick(bookersFor(branchId)).id;
    const touched = latest(
      createdAt,
      ...[confirmedAt, checkedInAt, completedAt, cancelledAt, reminderEmailSentAt].filter(Boolean)
    );

    const row = rows.push('appointments', {
      id,
      patientId: patient.id,
      branchId,
      dentistId: dentist.id,
      chairId: chair ? chair.id : null,
      startAt: dt(start),
      endAt: dt(end),
      type,
      status,
      isWalkIn: isWalkIn ? 1 : 0,
      treatmentPlanItemId: null,
      recallId: null,
      reasonNote,
      cancellationReason,
      cancelledBy,
      cancelledAt: dt(cancelledAt),
      confirmedAt: dt(confirmedAt),
      checkedInAt: dt(checkedInAt),
      completedAt: dt(completedAt),
      reminderEmailSentAt: dt(reminderEmailSentAt),
      createdBy,
      createdAt: dt(createdAt),
      updatedAt: dt(touched),
    });

    const entity = {
      id,
      patientId: patient.id,
      branchId,
      dentistId: dentist.id,
      chairId: chair ? chair.id : null,
      startAt: start,
      endAt: end,
      status,
      type,
      isPast: ms(start) < ms(TODAY),
      isWalkIn,
      treatmentPlanItemId: null,
      recallId: null,
      row,
    };
    appointments.push(entity);

    occupy(patientBusy, patient.id, start, end);
    if (BLOCKING.has(status)) {
      occupy(chairBusy, entity.chairId, start, end);
      occupy(dentistBusy, dentist.id, start, end);
    }
    return entity;
  }

  /* ── Slot search ───────────────────────────────────────────────────── */

  /**
   * Find a patient, dentist, chair and free window on `dayDate`. Returns null
   * if the diary is genuinely full for the constraints given.
   */
  function findSlot(dayDate, durationMin, window = { from: OPEN_MIN, to: LAST_START_MIN }) {
    if (!eligible.length) return null;
    const lastStart = Math.min(window.to, CLOSE_MIN - durationMin);
    if (lastStart < window.from) return null;
    const steps = Math.floor((lastStart - window.from) / SLOT_MIN);

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const { patient, created } = pick(eligible);
      const start = atMin(dayDate, window.from + int(0, steps) * SLOT_MIN);
      if (ms(start) < ms(created)) continue;
      const end = plusMinutes(start, durationMin);
      if (!isFree(patientBusy, patient.id, start, end)) continue;

      const dentists = shuffle(dentistsFor(patient.branchId));
      if (!dentists.length) continue;
      const options = chairsFor(patient.branchId);
      const chairChoices = options.length ? shuffle(options) : [null];

      for (const dentist of dentists) {
        if (isAway(dentist.id, start, end)) continue;
        if (!isFree(dentistBusy, dentist.id, start, end)) continue;
        for (const chair of chairChoices) {
          if (!isFree(chairBusy, chair ? chair.id : null, start, end)) continue;
          return { patient, created, dentist, chair, start, end };
        }
      }
    }
    return null;
  }

  function durationFor(type) {
    if (type === TYPE_PROCEDURE) return pick([45, 60, 60, 75, 90]);
    return 30;
  }

  function reasonFor(type) {
    return pick(REASONS[type] ?? REASONS[TYPE_PROCEDURE]);
  }

  /**
   * When the booking was taken. Booked-ahead appointments are entered a few
   * days early; nothing may be created in the future or before the patient
   * existed.
   */
  function bookedAt(start, created, sameDay) {
    if (sameDay) {
      return latest(plusMinutes(start, -int(5, 45)), created);
    }
    let candidate = at(plusDays(start, -int(2, 18)), int(9, 18), pick([0, 15, 30, 45]));
    const ceiling = Math.min(ms(TODAY), ms(start) - 30 * 60_000);
    if (ms(candidate) > ceiling) {
      candidate = at(plusDays(new Date(ceiling), -int(0, 21)), int(9, 18), pick([0, 15, 30, 45]));
    }
    return new Date(Math.max(Math.min(ms(candidate), ceiling), ms(created)));
  }

  /** Somewhere between the booking and a ceiling, without inverting either. */
  function confirmedBetween(createdAt, ceiling) {
    const candidate = plusMinutes(createdAt, int(60, 3 * 1440));
    return new Date(Math.max(Math.min(ms(candidate), ms(ceiling)), ms(createdAt)));
  }

  /* ── Past days ─────────────────────────────────────────────────────── */

  let walkInExemplarUsed = false;

  function buildPastAppointment(dayDate) {
    const walkIn = chance(0.10);
    // The first walk-in is the textbook one: pain, swelling, no appointment.
    const exemplar = walkIn && !walkInExemplarUsed;
    const type = exemplar
      ? TYPE_EMERGENCY
      : walkIn
      ? weighted([
          [TYPE_EMERGENCY, 6],
          [TYPE_CONSULTATION, 2],
          [TYPE_PROCEDURE, 2],
        ])
      : weighted([
          [TYPE_PROCEDURE, 44],
          [TYPE_CHECKUP, 18],
          [TYPE_CONSULTATION, 18],
          [TYPE_FOLLOW_UP, 14],
          [TYPE_EMERGENCY, 6],
        ]);

    const slot = findSlot(dayDate, durationFor(type));
    if (!slot) return null;

    const status = walkIn
      ? STATUS_COMPLETED
      : weighted([
          [STATUS_COMPLETED, 78],
          [STATUS_CANCELLED, 9],
          [STATUS_NO_SHOW, 8],
          // Seen and finished, but the front desk never closed it off.
          [STATUS_CONFIRMED, 5],
        ]);

    let createdAt = bookedAt(slot.start, slot.created, walkIn);
    let reasonNote = null;
    if (walkIn) {
      reasonNote = exemplar ? REASONS[TYPE_EMERGENCY][0] : reasonFor(type);
      walkInExemplarUsed = true;
    } else if (chance(0.33)) {
      reasonNote = reasonFor(type);
    }

    const marks = {};
    if (status === STATUS_COMPLETED) {
      marks.checkedInAt = plusMinutes(slot.start, int(-15, 10));
      marks.completedAt = plusMinutes(slot.end, int(-10, 20));
      // A walk-in never passed through confirmation; it is stamped at check-in.
      marks.confirmedAt = walkIn
        ? marks.checkedInAt
        : confirmedBetween(createdAt, plusMinutes(marks.checkedInAt, -30));
      if (walkIn) createdAt = earliest(createdAt, marks.checkedInAt);
    } else if (status === STATUS_CANCELLED) {
      const called = latest(
        plusMinutes(slot.start, -int(30, 96 * 60)),
        plusMinutes(createdAt, int(15, 240))
      );
      marks.cancelledAt = earliest(called, plusMinutes(slot.start, -15));
      // Half of them had been confirmed before the patient called off.
      if (chance(0.5)) {
        marks.confirmedAt = confirmedBetween(createdAt, plusMinutes(marks.cancelledAt, -15));
      }
      marks.cancellationReason = pick(CANCELLATION_REASONS);
      marks.cancelledBy = pick(bookersFor(slot.patient.branchId)).id;
    } else if (status === STATUS_CONFIRMED) {
      marks.confirmedAt = confirmedBetween(createdAt, plusMinutes(slot.start, -60));
    }
    // A no-show carries status and nothing else — who marked it lives in audit_logs.

    return pushAppointment({
      ...slot,
      type,
      status,
      isWalkIn: walkIn,
      reasonNote,
      createdAt,
      ...marks,
    });
  }

  /* ── Today — the front-desk queue ──────────────────────────────────── */

  function buildToday(dayDate) {
    // Morning list, already seen and closed off.
    for (let i = 0; i < int(3, 4); i += 1) {
      const type = weighted([
        [TYPE_CHECKUP, 3],
        [TYPE_PROCEDURE, 3],
        [TYPE_CONSULTATION, 2],
        [TYPE_FOLLOW_UP, 1],
      ]);
      const duration = type === TYPE_PROCEDURE ? pick([45, 60]) : 30;
      // The clinic opens at 09:00; an 08:xx slot would sit outside its own hours.
      const slot = findSlot(dayDate, duration, { from: 9 * 60, to: 11 * 60 + 45 - duration });
      if (!slot) continue;
      const createdAt = bookedAt(slot.start, slot.created, false);
      const checkedInAt = plusMinutes(slot.start, int(-12, 8));
      pushAppointment({
        ...slot,
        type,
        status: STATUS_COMPLETED,
        reasonNote: chance(0.4) ? reasonFor(type) : null,
        createdAt,
        confirmedAt: confirmedBetween(createdAt, plusMinutes(checkedInAt, -60)),
        checkedInAt,
        completedAt: plusMinutes(slot.end, int(-8, 10)),
      });
    }

    // Waiting room: checkedInAt is what the queue's wait timer counts from.
    for (const startMin of pickN([11 * 60 + 45, 12 * 60, 12 * 60 + 15], 2)) {
      const type = weighted([
        [TYPE_PROCEDURE, 3],
        [TYPE_CHECKUP, 2],
        [TYPE_CONSULTATION, 2],
      ]);
      const duration = durationFor(type);
      const slot = findSlot(dayDate, duration, { from: startMin, to: startMin });
      if (!slot) continue;
      const createdAt = bookedAt(slot.start, slot.created, false);
      const checkedInAt = plusMinutes(TODAY, -int(10, 40));
      pushAppointment({
        ...slot,
        type,
        status: STATUS_CHECKED_IN,
        reasonNote: chance(0.4) ? reasonFor(type) : null,
        createdAt,
        confirmedAt: confirmedBetween(createdAt, plusMinutes(checkedInAt, -60)),
        checkedInAt,
      });
    }

    // In the chair right now: started before the anchor, ends after it.
    for (const startMin of [11 * 60 + 30, 11 * 60 + 15, 11 * 60 + 45]) {
      const duration = pick([60, 75]);
      const slot = findSlot(dayDate, duration, { from: startMin, to: startMin });
      if (!slot) continue;
      const createdAt = bookedAt(slot.start, slot.created, false);
      const checkedInAt = plusMinutes(TODAY, -int(15, 40));
      pushAppointment({
        ...slot,
        type: TYPE_PROCEDURE,
        status: STATUS_IN_PROGRESS,
        reasonNote: reasonFor(TYPE_PROCEDURE),
        createdAt,
        confirmedAt: confirmedBetween(createdAt, plusMinutes(checkedInAt, -60)),
        checkedInAt,
      });
      break;
    }

    // Afternoon list, still to come.
    for (let i = 0; i < int(4, 6); i += 1) {
      const type = weighted([
        [TYPE_PROCEDURE, 40],
        [TYPE_CHECKUP, 20],
        [TYPE_CONSULTATION, 20],
        [TYPE_FOLLOW_UP, 14],
        [TYPE_EMERGENCY, 6],
      ]);
      const duration = durationFor(type);
      const slot = findSlot(dayDate, duration, { from: 13 * 60, to: 19 * 60 - duration });
      if (!slot) continue;
      const status = chance(0.55) ? STATUS_CONFIRMED : STATUS_SCHEDULED;
      const createdAt = bookedAt(slot.start, slot.created, false);
      pushAppointment({
        ...slot,
        type,
        status,
        reasonNote: chance(0.33) ? reasonFor(type) : null,
        createdAt,
        confirmedAt:
          status === STATUS_CONFIRMED
            ? confirmedBetween(createdAt, plusMinutes(TODAY, -int(30, 900)))
            : null,
      });
    }
  }

  /* ── Future days ───────────────────────────────────────────────────── */

  const tomorrow = day(1);

  function buildFutureAppointment(dayDate) {
    const type = weighted([
      [TYPE_PROCEDURE, 42],
      [TYPE_CHECKUP, 20],
      [TYPE_CONSULTATION, 20],
      [TYPE_FOLLOW_UP, 14],
      [TYPE_EMERGENCY, 4],
    ]);
    const slot = findSlot(dayDate, durationFor(type));
    if (!slot) return null;

    const status = chance(0.55) ? STATUS_CONFIRMED : STATUS_SCHEDULED;
    const createdAt = bookedAt(slot.start, slot.created, false);

    return pushAppointment({
      ...slot,
      type,
      status,
      reasonNote: chance(0.3) ? reasonFor(type) : null,
      createdAt,
      confirmedAt:
        status === STATUS_CONFIRMED
          ? confirmedBetween(createdAt, plusMinutes(TODAY, -int(30, 4320)))
          : null,
    });
  }

  /* ── The diary, 120 days back to 28 days forward ───────────────────── */

  function perDayCount(offset) {
    if (offset < -90) return int(2, 3);
    if (offset < -60) return int(2, 4);
    if (offset < -30) return int(3, 4);
    if (offset < -7) return int(3, 5);
    if (offset < 0) return int(4, 6);
    // The next two days carry the reminder job's working set.
    if (offset <= 2) return int(4, 6);
    if (offset <= 7) return int(3, 5);
    if (offset <= 14) return int(2, 4);
    return int(1, 3);
  }

  for (let offset = -120; offset <= 28; offset += 1) {
    const dayDate = day(offset);
    if (!isClinicDay(dayDate)) continue;
    admitPatientsFor(dayDate);
    if (!eligible.length) continue;

    if (offset === 0) {
      buildToday(dayDate);
      continue;
    }
    const count = perDayCount(offset);
    for (let i = 0; i < count; i += 1) {
      if (offset < 0) buildPastAppointment(dayDate);
      else buildFutureAppointment(dayDate);
    }
  }

  /* ── Reminders ─────────────────────────────────────────────────────── */

  // The reminder job's default window is tomorrow, and its idempotency guard
  // is this column. Tomorrow's list is therefore split deliberately: some
  // already sent for the run to skip, the rest still to send. Nothing outside
  // that window is stamped.
  const tomorrowsList = appointments.filter(
    (a) => ms(a.startAt) >= ms(tomorrow) && ms(a.startAt) < ms(day(2))
  );
  if (tomorrowsList.length >= 2) {
    const sentCount = Math.min(tomorrowsList.length - 1, Math.max(1, Math.round(tomorrowsList.length * 0.55)));
    for (const appointment of shuffle(tomorrowsList).slice(0, sentCount)) {
      // Sent by this morning's run.
      const stamp = dt(at(day(0), 8, pick([0, 5, 10, 15, 20, 25, 30])));
      appointment.row.reminderEmailSentAt = stamp;
      if (stamp > appointment.row.updatedAt) appointment.row.updatedAt = stamp;
    }
  }

  /* ── Treatment plan item ↔ appointment ─────────────────────────────── */

  const byPatient = new Map();
  for (const appointment of appointments) {
    if (!byPatient.has(appointment.patientId)) byPatient.set(appointment.patientId, []);
    byPatient.get(appointment.patientId).push(appointment);
  }

  const linkable = [];
  for (const plan of world.plans ?? []) {
    if (!PLAN_LINKABLE.has(plan.status)) continue;
    for (const item of plan.items ?? []) {
      if (!item.row || item.appointmentId) continue;
      if (item.status !== 'scheduled' && item.status !== 'completed') continue;
      linkable.push({ plan, item });
    }
  }

  let linked = 0;
  for (const { plan, item } of shuffle(linkable)) {
    if (linked >= 14) break;
    const pool = byPatient.get(plan.patientId) ?? [];
    const wantsFuture = item.status === 'scheduled';
    const usable = pool.filter((a) => {
      if (a.treatmentPlanItemId || a.recallId) return false;
      if (wantsFuture) return !a.isPast && (a.status === STATUS_SCHEDULED || a.status === STATUS_CONFIRMED);
      return a.status === STATUS_COMPLETED;
    });
    if (!usable.length) continue;
    // A procedure slot is the natural home for a plan item.
    const preferred = usable.filter((a) => a.type === TYPE_PROCEDURE);
    const appointment = pick(preferred.length ? preferred : usable);

    appointment.treatmentPlanItemId = item.id;
    appointment.row.treatmentPlanItemId = item.id;
    item.appointmentId = appointment.id;
    item.row.appointmentId = appointment.id;
    linked += 1;
  }

  /* ── Recalls ───────────────────────────────────────────────────────── */

  const procedureByCode = new Map((world.procedures ?? []).map((p) => [p.code, p]));

  /** The three seeded procedures that carry a recall interval. */
  const SOURCES = [
    { code: 'SC-01', recallType: 'preventive', intervalMonths: 6, note: '6-month scaling recall', weight: 5 },
    { code: 'CON-01', recallType: 'diagnostic', intervalMonths: 6, note: '6-month check-up recall', weight: 3 },
    { code: 'ORT-03', recallType: 'orthodontic', intervalMonths: 1, note: 'Monthly ortho adjustment due', weight: 2 },
  ].map((source) => {
    const procedure = procedureByCode.get(source.code);
    return {
      ...source,
      recallType: procedure?.category ?? source.recallType,
      intervalMonths: procedure?.defaultRecallMonths ?? source.intervalMonths,
    };
  });

  const sourceWeights = SOURCES.map((s) => [s, s.weight]);

  // The app dedupes a pending recall against another of the same type due
  // within 30 days, so demo data must not manufacture the very thing it hides.
  const DEDUPE_WINDOW_MS = 30 * 24 * 60 * 60_000;
  const pendingSeen = new Map();

  function pendingCollides(patientId, recallType, due) {
    const seen = pendingSeen.get(`${patientId}|${recallType}`);
    return Boolean(seen && seen.some((d) => Math.abs(d - ms(due)) < DEDUPE_WINDOW_MS));
  }

  function rememberPending(patientId, recallType, due) {
    const key = `${patientId}|${recallType}`;
    if (!pendingSeen.has(key)) pendingSeen.set(key, []);
    pendingSeen.get(key).push(ms(due));
  }

  const recalls = [];

  function pushRecall({ patient, source, status, dueDate, appointment = null }) {
    const id = uuid();
    // The recall is raised at the visit that triggered it — one interval back,
    // but never in the future.
    let createdAt = plusMonths(dueDate, -source.intervalMonths);
    if (ms(createdAt) > ms(TODAY)) createdAt = at(day(-int(1, 30)), int(10, 17), pick([0, 15, 30, 45]));
    createdAt = at(createdAt, int(10, 17), pick([0, 15, 30, 45]));

    let touched = createdAt;
    if (status !== RECALL_PENDING) {
      touched = new Date(Math.min(ms(plusDays(createdAt, int(1, 40))), ms(TODAY)));
      if (ms(touched) < ms(createdAt)) touched = createdAt;
    }

    const row = rows.push('recalls', {
      id,
      patientId: patient.id,
      branchId: patient.branchId,
      recallType: source.recallType,
      dueDate: dateOnly(dueDate),
      intervalMonths: source.intervalMonths,
      status,
      appointmentId: appointment ? appointment.id : null,
      sourceVisitId: null,
      notes: chance(0.55) ? source.note : null,
      createdBy: pick(bookersFor(patient.branchId)).id,
      createdAt: dt(createdAt),
      updatedAt: dt(touched),
    });

    const entity = {
      id,
      patientId: patient.id,
      branchId: patient.branchId,
      recallType: source.recallType,
      dueDate,
      status,
      appointmentId: appointment ? appointment.id : null,
      sourceVisitId: null,
      row,
    };
    recalls.push(entity);

    if (status === RECALL_PENDING) rememberPending(patient.id, source.recallType, dueDate);
    return entity;
  }

  /** Pick a patient whose pending recall of this type would not be a duplicate. */
  function recallSubject(status, dueDate) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const source = weighted(sourceWeights);
      const { patient } = pick(byCreation);
      if (status === RECALL_PENDING && pendingCollides(patient.id, source.recallType, dueDate)) continue;
      return { patient, source };
    }
    return null;
  }

  function makeRecall(status, dueDate, appointment = null) {
    if (appointment) {
      const patient = patients.find((p) => p.id === appointment.patientId);
      if (!patient) return null;
      return pushRecall({ patient, source: weighted(sourceWeights), status, dueDate, appointment });
    }
    const subject = recallSubject(status, dueDate);
    if (!subject) return null;
    return pushRecall({ ...subject, status, dueDate });
  }

  // Half the pending list is already past due — the worklist derives "overdue"
  // from (pending AND dueDate <= now), so there is nothing to store for it.
  for (let i = 0; i < 8; i += 1) makeRecall(RECALL_PENDING, day(-int(3, 70)));
  for (let i = 0; i < 8; i += 1) makeRecall(RECALL_PENDING, day(int(3, 120)));
  for (let i = 0; i < 6; i += 1) makeRecall(RECALL_CONTACTED, day(int(-30, 25)));
  for (let i = 0; i < 5; i += 1) makeRecall(RECALL_COMPLETED, day(-int(5, 70)));
  makeRecall(RECALL_CANCELLED, day(int(-40, 60)));

  // Booked recalls point at a real future slot, and that slot points back.
  const bookable = shuffle(
    appointments.filter(
      (a) =>
        !a.isPast &&
        !a.recallId &&
        !a.treatmentPlanItemId &&
        (a.status === STATUS_SCHEDULED || a.status === STATUS_CONFIRMED)
    )
  ).slice(0, 6);

  for (const appointment of bookable) {
    const recall = makeRecall(RECALL_BOOKED, appointment.startAt, appointment);
    if (!recall) continue;
    appointment.recallId = recall.id;
    appointment.row.recallId = recall.id;
  }

  /* ── Register ──────────────────────────────────────────────────────── */

  world.appointments = [...(world.appointments ?? []), ...appointments];
  world.recalls = [...(world.recalls ?? []), ...recalls];
}
