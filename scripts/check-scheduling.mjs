/**
 * Exercises the appointment book against the live database.
 *
 * MySQL has no exclusion constraint, so nothing but application code prevents
 * a double-booked chair. This checks that the conflict predicate actually
 * catches what it should — and, just as importantly, does NOT flag
 * back-to-back appointments.
 *
 *   npm run check:scheduling
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { fromClinicParts, fmtTime, parseHHMM } from '../lib/datetime';
import { generateSlots, subtract } from '../lib/intervals';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  timezone: 'Z',
});

let failed = 0;
const check = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok   ' : 'FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};

const made = { patients: [], appointments: [] };

/** The same bounded overlap predicate the availability engine uses. */
async function conflictsFor({ dentistId, chairId, startAt, endAt, excludeId }) {
  const lower = new Date(startAt.getTime() - 480 * 60_000);
  const params = [lower, endAt, startAt];
  let sql = `SELECT id FROM appointments
              WHERE startAt > ? AND startAt < ? AND endAt > ?
                AND status IN ('scheduled','confirmed','checked_in','in_progress','completed')`;
  if (dentistId) { sql += ' AND dentistId = ?'; params.push(dentistId); }
  if (chairId) { sql += ' AND chairId = ?'; params.push(chairId); }
  if (excludeId) { sql += ' AND id <> ?'; params.push(excludeId); }
  const [rows] = await conn.query(sql, params);
  return rows;
}

async function book({ patientId, branchId, dentistId, chairId, startAt, endAt, status = 'scheduled' }) {
  const id = randomUUID();
  made.appointments.push(id);
  await conn.query(
    `INSERT INTO appointments (id, patientId, branchId, dentistId, chairId, startAt, endAt,
                               type, status, isWalkIn, createdBy, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,'procedure',?,0,?,NOW(),NOW())`,
    [id, patientId, branchId, dentistId, chairId, startAt, endAt, status, dentistId]
  );
  return id;
}

try {
  const [[branch]] = await conn.query('SELECT id FROM branches LIMIT 1');
  const [[dentist]] = await conn.query('SELECT id FROM admin_users LIMIT 1');
  const [chairRows] = await conn.query('SELECT id, name FROM chairs ORDER BY name');
  const [chairOne, chairTwo] = chairRows;
  const [[settings]] = await conn.query('SELECT workStartTime, workEndTime, slotMinutes FROM clinic_settings LIMIT 1');
  console.log(`Chairs: ${chairRows.map((c) => c.name).join(', ')} | Hours ${settings.workStartTime}-${settings.workEndTime} @ ${settings.slotMinutes}min\n`);

  const patientId = randomUUID();
  made.patients.push(patientId);
  await conn.query(
    `INSERT INTO patients (id, mrn, branchId, firstName, phone, status, createdAt, updatedAt)
     VALUES (?,?,?,?,?,'active',NOW(),NOW())`,
    [patientId, `ZZS-${Date.now() % 1000000}`, branch.id, 'ScheduleCheck', '+923000000003']
  );

  // A quiet future date, so nothing real is nearby.
  const nine = fromClinicParts(2027, 3, 15, 9, 0);
  const nineThirty = fromClinicParts(2027, 3, 15, 9, 30);
  const ten = fromClinicParts(2027, 3, 15, 10, 0);
  const nineFifteen = fromClinicParts(2027, 3, 15, 9, 15);

  const first = await book({
    patientId, branchId: branch.id, dentistId: dentist.id,
    chairId: chairOne.id, startAt: nine, endAt: nineThirty,
  });

  /* Half-open intervals ------------------------------------------------ */

  const backToBack = await conflictsFor({
    dentistId: dentist.id, chairId: chairOne.id, startAt: nineThirty, endAt: ten,
  });
  check(
    'a back-to-back booking is NOT a conflict',
    backToBack.length === 0,
    `${fmtTime(nine)}-${fmtTime(nineThirty)} then ${fmtTime(nineThirty)}-${fmtTime(ten)}`
  );

  const overlapping = await conflictsFor({
    dentistId: dentist.id, chairId: chairOne.id, startAt: nineFifteen, endAt: ten,
  });
  check(
    'an overlapping booking IS a conflict',
    overlapping.length === 1 && overlapping[0].id === first,
    `${fmtTime(nineFifteen)}-${fmtTime(ten)} hits ${fmtTime(nine)}-${fmtTime(nineThirty)}`
  );

  /* Chair independence -------------------------------------------------- */

  const otherChair = await conflictsFor({
    chairId: chairTwo.id, startAt: nineFifteen, endAt: ten,
  });
  check('the same time on another chair is free', otherChair.length === 0, chairTwo.name);

  /* Rescheduling must not collide with itself -------------------------- */

  const self = await conflictsFor({
    dentistId: dentist.id, chairId: chairOne.id,
    startAt: nine, endAt: nineThirty, excludeId: first,
  });
  check('an appointment does not block its own reschedule', self.length === 0);

  /* Cancelled and no-show free the slot -------------------------------- */

  await conn.query("UPDATE appointments SET status='cancelled' WHERE id=?", [first]);
  const afterCancel = await conflictsFor({
    dentistId: dentist.id, chairId: chairOne.id, startAt: nineFifteen, endAt: ten,
  });
  check('a cancelled appointment frees its slot', afterCancel.length === 0);

  await conn.query("UPDATE appointments SET status='no_show' WHERE id=?", [first]);
  const afterNoShow = await conflictsFor({
    dentistId: dentist.id, chairId: chairOne.id, startAt: nineFifteen, endAt: ten,
  });
  check('a no-show frees its slot too', afterNoShow.length === 0);

  await conn.query("UPDATE appointments SET status='scheduled' WHERE id=?", [first]);

  /* An unassigned chair never conflicts on the chair axis --------------- */

  const unassigned = await book({
    patientId, branchId: branch.id, dentistId: dentist.id,
    chairId: null, startAt: fromClinicParts(2027, 3, 15, 14, 0),
    endAt: fromClinicParts(2027, 3, 15, 14, 30),
  });
  const [[row]] = await conn.query('SELECT chairId FROM appointments WHERE id=?', [unassigned]);
  check('an appointment can be booked without a chair', row.chairId === null);

  /* Slot generation from real clinic hours ------------------------------ */

  const dayWindow = [{ start: parseHHMM(settings.workStartTime), end: parseHHMM(settings.workEndTime) }];
  const busy = [{ start: parseHHMM('09:00'), end: parseHHMM('09:30') }];
  const free = subtract(dayWindow, busy);
  const slots = generateSlots(free, 30, settings.slotMinutes);

  check(
    'slots start after the booked half hour',
    slots.length > 0 && slots[0].start === parseHHMM('09:30'),
    slots.length ? `first at ${Math.floor(slots[0].start / 60)}:${String(slots[0].start % 60).padStart(2, '0')}` : 'none'
  );
  check(
    'no slot runs past closing time',
    slots.every((s) => s.end <= parseHHMM(settings.workEndTime)),
    `${slots.length} slots`
  );
  check(
    'slots sit on the clinic grid',
    slots.every((s) => s.start % settings.slotMinutes === 0),
    `every ${settings.slotMinutes} minutes`
  );
} finally {
  if (made.appointments.length) {
    await conn.query(
      `DELETE FROM appointments WHERE id IN (${made.appointments.map(() => '?').join(',')})`,
      made.appointments
    );
  }
  if (made.patients.length) {
    await conn.query(
      `DELETE FROM patients WHERE id IN (${made.patients.map(() => '?').join(',')})`,
      made.patients
    );
  }
  console.log('\nCleaned up the scheduling test data.');
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nThe appointment book behaves correctly.');
