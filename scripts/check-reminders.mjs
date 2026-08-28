/**
 * Exercises the reminder pipeline through the REAL HTTP endpoint.
 *
 * Needs the dev server running with EMAIL_DRY_RUN=1 and CRON_SECRET set, so
 * nothing actually emails anyone. Creates an appointment for tomorrow with an
 * email on file and one without, runs the cron twice, and verifies:
 * idempotency, the skipped row for the phone-only patient, and the
 * communication_logs trail. Cleans up afterwards.
 *
 *   EMAIL_DRY_RUN=1 CRON_SECRET=check-secret-123 npm run dev &
 *   npm run check:reminders
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const BASE = process.env.CHECK_BASE_URL ?? 'http://localhost:3000';
const SECRET = process.env.CRON_SECRET ?? 'check-secret-123';

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

const made = { patients: [], appointments: [], recalls: [] };

async function runCron() {
  const res = await fetch(`${BASE}/api/cron/daily`, {
    headers: { 'x-cron-secret': SECRET },
  });
  if (!res.ok) throw new Error(`cron returned ${res.status}: ${await res.text()}`);
  return res.json();
}

try {
  const [[branch]] = await conn.query('SELECT id FROM branches LIMIT 1');
  const [[dentist]] = await conn.query('SELECT id FROM admin_users LIMIT 1');

  /* Wrong secret must be rejected --------------------------------------- */

  const bad = await fetch(`${BASE}/api/cron/daily`, { headers: { 'x-cron-secret': 'wrong' } });
  check('the cron rejects a wrong secret', bad.status === 401);
  const none = await fetch(`${BASE}/api/cron/daily`);
  check('and a missing one', none.status === 401);

  /* Two patients: one reachable, one phone-only ------------------------- */

  const emailPatient = randomUUID();
  const phonePatient = randomUUID();
  made.patients.push(emailPatient, phonePatient);

  await conn.query(
    `INSERT INTO patients (id, mrn, branchId, firstName, phone, email, status, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,'active',NOW(),NOW()), (?,?,?,?,?,NULL,'active',NOW(),NOW())`,
    [
      emailPatient, `ZZR-${Date.now() % 1000000}`, branch.id, 'ReminderCheck',
      '+923000000005', 'reminder-check@example.invalid',
      phonePatient, `ZZQ-${Date.now() % 1000000}`, branch.id, 'PhoneOnly', '+923000000006',
    ]
  );

  // Tomorrow 10:00 and 11:00, stored as naive wall clock.
  const [emailAppt, phoneAppt] = [randomUUID(), randomUUID()];
  made.appointments.push(emailAppt, phoneAppt);
  await conn.query(
    `INSERT INTO appointments (id, patientId, branchId, dentistId, startAt, endAt, type, status,
                               isWalkIn, createdBy, createdAt, updatedAt)
     VALUES
       (?,?,?,?, DATE_ADD(CURDATE(), INTERVAL 34 HOUR), DATE_ADD(CURDATE(), INTERVAL 34.5 HOUR),
        'checkup','scheduled',0,?,NOW(),NOW()),
       (?,?,?,?, DATE_ADD(CURDATE(), INTERVAL 35 HOUR), DATE_ADD(CURDATE(), INTERVAL 35.5 HOUR),
        'checkup','scheduled',0,?,NOW(),NOW())`,
    [emailAppt, emailPatient, branch.id, dentist.id, dentist.id,
     phoneAppt, phonePatient, branch.id, dentist.id, dentist.id]
  );

  // An overdue recall for the reachable patient.
  const recallId = randomUUID();
  made.recalls.push(recallId);
  await conn.query(
    `INSERT INTO recalls (id, patientId, branchId, recallType, dueDate, status, createdBy, createdAt, updatedAt)
     VALUES (?,?,?,'diagnostic', DATE_SUB(NOW(), INTERVAL 3 DAY), 'pending', ?, NOW(), NOW())`,
    [recallId, emailPatient, branch.id, dentist.id]
  );

  /* First run ----------------------------------------------------------- */

  const first = await runCron();
  check(
    'the run reports both appointments as eligible',
    first.appointmentReminders.eligible >= 2,
    JSON.stringify(first.appointmentReminders)
  );
  check('one reminder was sent (dry run)', first.appointmentReminders.sent >= 1);
  check(
    'the phone-only patient was skipped, not errored',
    first.appointmentReminders.skipped >= 1
  );
  check('the recall reminder went out', first.recallReminders.sent >= 1,
    JSON.stringify(first.recallReminders));

  const [[stamped]] = await conn.query(
    'SELECT reminderEmailSentAt FROM appointments WHERE id = ?', [emailAppt]
  );
  check('reminderEmailSentAt is stamped on success', stamped.reminderEmailSentAt !== null);

  const [[unstamped]] = await conn.query(
    'SELECT reminderEmailSentAt FROM appointments WHERE id = ?', [phoneAppt]
  );
  check(
    'the skipped appointment stays unstamped, visible as a call-list entry',
    unstamped.reminderEmailSentAt === null
  );

  const [logs] = await conn.query(
    `SELECT channel, status, templateKey, referenceType, referenceId
       FROM communication_logs WHERE patientId IN (?, ?) ORDER BY createdAt`,
    [emailPatient, phonePatient]
  );
  check(
    'every attempt left a communication_logs row',
    logs.length >= 3,
    `${logs.length} rows`
  );
  check(
    'the reminder is traceable to its appointment',
    logs.some((l) => l.referenceType === 'appointment' && l.referenceId === emailAppt &&
      l.templateKey === 'appointment_reminder' && l.status === 'sent')
  );
  check(
    'the no-address case is a skipped row',
    logs.some((l) => l.status === 'skipped' && l.referenceId === phoneAppt)
  );
  check(
    'the recall reminder is traceable to its recall',
    logs.some((l) => l.referenceType === 'recall' && l.referenceId === recallId && l.status === 'sent')
  );

  /* Second run: idempotency --------------------------------------------- */

  const second = await runCron();
  const sentAgain = second.appointmentReminders.sent;
  const recallAgain = second.recallReminders.sent;
  check('a second run sends no appointment reminder twice', sentAgain === 0,
    JSON.stringify(second.appointmentReminders));
  check('nor the recall reminder', recallAgain === 0, JSON.stringify(second.recallReminders));
} finally {
  if (made.patients.length) {
    await conn.query(
      `DELETE FROM communication_logs WHERE patientId IN (${made.patients.map(() => '?').join(',')})`,
      made.patients
    );
  }
  for (const [table, ids] of [
    ['recalls', made.recalls],
    ['appointments', made.appointments],
    ['patients', made.patients],
  ]) {
    if (!ids.length) continue;
    await conn.query(`DELETE FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  console.log('\nCleaned up the reminder test data.');
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nThe reminder pipeline behaves correctly.');
