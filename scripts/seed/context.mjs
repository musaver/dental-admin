/**
 * Shared contract for the demo-data seed.
 *
 * Every module in this directory builds against exactly this API. Two rules
 * make the whole thing safe to re-run and safe to reason about:
 *
 * 1. DETERMINISM. The PRNG is seeded, so `npm run seed` twice produces
 *    byte-identical data. Bug reports against demo data are reproducible.
 *
 * 2. NAIVE CLINIC-LOCAL DATETIMES. Every datetime that reaches MySQL is a
 *    'YYYY-MM-DD HH:MM:SS' *string* built from UTC getters — never a JS Date
 *    handed to the driver. The pool runs `timezone: 'Z'`, and the app reads
 *    wall-clock time back with UTC getters (see lib/datetime.ts), so a string
 *    is the only representation that cannot drift. This mirrors CONVENTIONS.md.
 *
 * Modules never touch the database. They push plain row objects into `rows`
 * and register entities on `world`; scripts/seed.mjs does the inserting, in a
 * fixed dependency order, and then recomputes every denormalised field so
 * `npm run check:invariants` passes by construction rather than by luck.
 *
 * ── The `world` shape (what each module may read and must produce) ─────────
 *
 *   world.branches   [{ id, name, code, city, isMain }]
 *   world.chairs     [{ id, branchId, name }]
 *   world.staff      [{ id, name, email, password, roleId, roleName, branchId,
 *                       staffType, isClinical, isActive }]
 *   world.procedures [{ id, code, name, category, defaultPrice, durationMinutes,
 *                       isPerTooth, defaultRecallMonths }]   (read-only, seeded)
 *   world.patients   [{ id, mrn, branchId, firstName, lastName, fullName, gender,
 *                       dobIso, phone, email, isChild, hasAlerts, portalUserId }]
 *   world.plans      [{ id, patientId, branchId, dentistId, status, items: [
 *                       { id, procedureId, teeth, quantity, unitPrice,
 *                         discountType, discountValue, netAmount, status,
 *                         appointmentId, visitProcedureId } ] }]
 *   world.appointments [{ id, patientId, branchId, dentistId, chairId, startAt,
 *                       endAt, status, type, isPast, recallId, treatmentPlanItemId }]
 *   world.visits     [{ id, patientId, branchId, dentistId, appointmentId,
 *                       visitDate, status, procedures: [
 *                       { id, procedureId, teeth, quantity, price, treatmentPlanItemId } ] }]
 *   world.recalls    [{ id, patientId, branchId, recallType, dueDate, status,
 *                       appointmentId, sourceVisitId }]
 *   world.invoices   [{ id, invoiceNumber, patientId, branchId, visitId,
 *                       treatmentPlanId, totalAmount, paidAmount, status }]
 *   world.leads      [{ id, branchId, name, status, convertedPatientId }]
 *   world.tasks      [{ id, title, branchId, assignedTo }]
 */
import { randomUUID } from 'node:crypto';

/* ── Deterministic randomness ─────────────────────────────────────────── */

/** mulberry32 — small, fast, and good enough for demo data. */
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260828;
const next = mulberry32(SEED);

/** Deterministic UUIDs, so re-seeding produces identical ids. */
let uuidCounter = 0;
export function uuid() {
  const hex = [];
  for (let i = 0; i < 16; i += 1) hex.push(Math.floor(next() * 256));
  // Stamp version 4 / variant 10 so these are well-formed UUIDs.
  hex[6] = (hex[6] & 0x0f) | 0x40;
  hex[8] = (hex[8] & 0x3f) | 0x80;
  uuidCounter += 1;
  const s = hex.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** A genuinely random id, for the rare row that must not collide across runs. */
export const trueUuid = randomUUID;

/** Integer in [min, max] inclusive. */
export function int(min, max) {
  return min + Math.floor(next() * (max - min + 1));
}

/** True with probability p. */
export function chance(p) {
  return next() < p;
}

export function pick(items) {
  return items[Math.floor(next() * items.length)];
}

/** n distinct items, or all of them if n exceeds the pool. */
export function pickN(items, n) {
  const pool = [...items];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  }
  return out;
}

/** Weighted pick: pass [[value, weight], …]. */
export function weighted(pairs) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let roll = next() * total;
  for (const [value, w] of pairs) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

/** Fisher-Yates, deterministic. */
export function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ── Clinic-local wall-clock time ─────────────────────────────────────── */

/**
 * The anchor "now" for the whole dataset. Fixed to noon so that "today" always
 * has both a completed morning and a scheduled afternoon, whatever hour the
 * seed is actually run at — the queue and diary pages then look alive rather
 * than empty.
 */
export const TODAY = new Date(Date.UTC(2026, 7, 28, 12, 0, 0));

/** Midnight on the day `n` days from the anchor. Negative n is the past. */
export function day(n) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** A wall-clock time on a given day. */
export function at(date, hours, minutes = 0) {
  const d = new Date(date);
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
}

/** Shift a datetime by whole minutes. */
export function plusMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function plusDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Calendar-month arithmetic that clamps rather than rolling over. */
export function plusMonths(date, months) {
  const d = new Date(date);
  const targetMonth = d.getUTCMonth() + months;
  const dayOfMonth = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(targetMonth);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dayOfMonth, lastDay));
  return d;
}

/** 0 = Sunday, matching lib/datetime.ts DAY_OF_WEEK and Date.getUTCDay(). */
export function dayOfWeek(date) {
  return date.getUTCDay();
}

/** The clinic is closed on Sundays. */
export function isClinicDay(date) {
  return dayOfWeek(date) !== 0;
}

/** Walk forward to the next day the clinic is open. */
export function nextClinicDay(date) {
  let d = new Date(date);
  while (!isClinicDay(d)) d = plusDays(d, 1);
  return d;
}

/**
 * The only correct way to hand a datetime to MySQL here: a naive
 * 'YYYY-MM-DD HH:MM:SS' string built from UTC getters.
 */
export function dt(date) {
  if (date === null || date === undefined) return null;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ` +
    `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`
  );
}

/** Date-only, for dateOfBirth and dueDate columns read as calendar days. */
export function dateOnly(date) {
  return dt(at(date, 0, 0));
}

/* ── Row collection ───────────────────────────────────────────────────── */

/**
 * Modules push here. The runner inserts each table in a fixed dependency
 * order, so a module never needs to care when its rows actually land.
 */
export function createRows() {
  const store = new Map();
  return {
    push(table, row) {
      if (!store.has(table)) store.set(table, []);
      store.get(table).push(row);
      return row;
    },
    all() {
      return store;
    },
    count(table) {
      return store.get(table)?.length ?? 0;
    },
    total() {
      let n = 0;
      for (const list of store.values()) n += list.length;
      return n;
    },
  };
}

/* ── People ───────────────────────────────────────────────────────────── */

export const MALE_FIRST = [
  'Ahmed', 'Ali', 'Bilal', 'Danish', 'Faisal', 'Hamza', 'Hassan', 'Imran',
  'Junaid', 'Kamran', 'Khalid', 'Naveed', 'Omar', 'Rizwan', 'Saad', 'Salman',
  'Shahzad', 'Tariq', 'Usman', 'Waleed', 'Yasir', 'Zeeshan', 'Adnan', 'Asad',
  'Fahad', 'Haris', 'Nabeel', 'Sufyan',
];

export const FEMALE_FIRST = [
  'Aisha', 'Amna', 'Ayesha', 'Fatima', 'Hina', 'Iqra', 'Kiran', 'Komal',
  'Mahnoor', 'Maria', 'Mehwish', 'Nadia', 'Nimra', 'Rabia', 'Saba', 'Sadia',
  'Sana', 'Sidra', 'Sumbal', 'Zainab', 'Areeba', 'Bushra', 'Farah', 'Hafsa',
  'Laiba', 'Momina', 'Noor', 'Rida',
];

export const LAST_NAMES = [
  'Ahmed', 'Akhtar', 'Ali', 'Anwar', 'Aslam', 'Bhatti', 'Butt', 'Chaudhry',
  'Farooq', 'Ghani', 'Gondal', 'Hussain', 'Iqbal', 'Javed', 'Khan', 'Khokhar',
  'Malik', 'Mehmood', 'Mirza', 'Nawaz', 'Qureshi', 'Raza', 'Rehman', 'Sheikh',
  'Siddiqui', 'Tariq', 'Yousaf', 'Zafar',
];

/** Mobile numbers in the normalized +92 form lib/patient-identity.ts produces. */
export function mobile(index) {
  const networks = ['300', '301', '321', '331', '333', '345', '312'];
  const net = networks[index % networks.length];
  const tail = String(1000000 + ((index * 7919) % 8999999)).slice(0, 7);
  return `+92${net}${tail}`;
}

/** A plausible CNIC. Format only — these are not real identity numbers. */
export function cnic(index) {
  const a = 35201 + (index % 5);
  const b = String(1000000 + ((index * 5347) % 8999999)).slice(0, 7);
  const c = (index % 9) + 1;
  return `${a}-${b}-${c}`;
}

/* ── Teeth (FDI, ISO 3950) ────────────────────────────────────────────── */

export const PERMANENT_TEETH = [
  ...[8, 7, 6, 5, 4, 3, 2, 1].map((n) => `1${n}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `2${n}`),
  ...[8, 7, 6, 5, 4, 3, 2, 1].map((n) => `4${n}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `3${n}`),
];

export const PRIMARY_TEETH = [
  ...[5, 4, 3, 2, 1].map((n) => `5${n}`),
  ...[1, 2, 3, 4, 5].map((n) => `6${n}`),
  ...[5, 4, 3, 2, 1].map((n) => `8${n}`),
  ...[1, 2, 3, 4, 5].map((n) => `7${n}`),
];

/** Molars and premolars — where caries and RCTs actually happen. */
export const POSTERIOR_TEETH = PERMANENT_TEETH.filter((t) => Number(t[1]) >= 4);
export const ANTERIOR_TEETH = PERMANENT_TEETH.filter((t) => Number(t[1]) <= 3);

/** Surface letters, packed as a string like "MOD" — never JSON. */
export function surfacesFor(tooth) {
  const posterior = Number(tooth[1]) >= 4;
  const pool = posterior ? ['M', 'O', 'D', 'B', 'L'] : ['M', 'I', 'D', 'B', 'L'];
  const order = posterior ? 'MODBL' : 'MIDBL';
  const chosen = pickN(pool, int(1, 3));
  return chosen.sort((a, b) => order.indexOf(a) - order.indexOf(b)).join('');
}

/** CSV form the schema stores in `teeth varchar(100)`. */
export function packTeeth(teeth) {
  return teeth.join(',');
}
