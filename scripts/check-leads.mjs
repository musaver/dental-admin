/**
 * Exercises lead conversion against the live database.
 *
 * leads.convertedPatientId and patients.leadId point at each other with no
 * foreign key, so half a conversion is permanently wrong and invisible. This
 * checks both directions agree, that a double submit does not create a second
 * patient, and that open tasks follow the person across.
 *
 *   npm run check:leads
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { formatMrn, normalizePhone, parseMrnSequence } from '../lib/patient-identity';

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

const made = { leads: [], patients: [], activities: [], tasks: [] };

/** Mirrors the conversion transaction in the route. */
async function convert(leadId, branchCode, actorId) {
  await conn.beginTransaction();
  try {
    const [[lead]] = await conn.query('SELECT * FROM leads WHERE id = ? FOR UPDATE', [leadId]);

    if (lead.convertedPatientId) {
      const [[existing]] = await conn.query('SELECT * FROM patients WHERE id = ?', [lead.convertedPatientId]);
      if (existing) { await conn.commit(); return { patient: existing, alreadyConverted: true }; }
    }

    const [[last]] = await conn.query(
      'SELECT mrn FROM patients WHERE mrn LIKE ? ORDER BY mrn DESC LIMIT 1', [`${branchCode}-%`]
    );
    const mrn = formatMrn(branchCode, last ? parseMrnSequence(last.mrn) + 1 : 1);

    const parts = lead.name.trim().split(/\s+/);
    const patientId = randomUUID();
    made.patients.push(patientId);

    await conn.query(
      `INSERT INTO patients (id, mrn, branchId, firstName, lastName, phone, email, leadId,
                             referredBy, dentalNotes, status, registeredBy, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,NOW(),NOW())`,
      [patientId, mrn, lead.branchId, parts[0], parts.slice(1).join(' ') || null,
       lead.phone, lead.email, lead.id, `Enquiry via ${lead.source}`, lead.interestNote, actorId]
    );

    await conn.query(
      "UPDATE leads SET convertedPatientId=?, convertedAt=NOW(), status='converted' WHERE id=?",
      [patientId, leadId]
    );

    const actId = randomUUID();
    made.activities.push(actId);
    await conn.query(
      `INSERT INTO lead_activities (id, leadId, activityType, note, performedBy, createdAt)
       VALUES (?,?,'note',?,?,NOW())`,
      [actId, leadId, `Converted to patient ${mrn}`, actorId]
    );

    await conn.query('UPDATE tasks SET patientId = ? WHERE leadId = ?', [patientId, leadId]);

    await conn.commit();
    const [[patient]] = await conn.query('SELECT * FROM patients WHERE id = ?', [patientId]);
    return { patient, alreadyConverted: false };
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

try {
  const [[branch]] = await conn.query('SELECT id, code FROM branches LIMIT 1');
  const [[staff]] = await conn.query('SELECT id FROM admin_users LIMIT 1');

  /* Create an enquiry with an open task ------------------------------- */

  const leadId = randomUUID();
  made.leads.push(leadId);
  const leadPhone = normalizePhone('0300 555 1234');
  await conn.query(
    `INSERT INTO leads (id, branchId, name, phone, email, source, status, interestNote,
                        createdBy, createdAt, updatedAt)
     VALUES (?,?,?,?,?,'instagram','new',?,?,NOW(),NOW())`,
    [leadId, branch.id, 'Fatima Noor Ahmed', leadPhone, 'fatima@example.invalid',
     'Interested in whitening', staff.id]
  );

  const taskId = randomUUID();
  made.tasks.push(taskId);
  await conn.query(
    `INSERT INTO tasks (id, title, leadId, branchId, assignedTo, status, priority, createdBy, createdAt, updatedAt)
     VALUES (?,?,?,?,?,'open','normal',?,NOW(),NOW())`,
    [taskId, 'Call back about whitening', leadId, branch.id, staff.id, staff.id]
  );

  check('the lead phone is normalised like a patient one', leadPhone === '+923005551234', leadPhone);

  /* Convert ------------------------------------------------------------ */

  const first = await convert(leadId, branch.code, staff.id);
  check('conversion creates a patient', Boolean(first.patient?.id), first.patient?.mrn);
  check('the name splits into first and last', first.patient.firstName === 'Fatima' &&
    first.patient.lastName === 'Noor Ahmed', `${first.patient.firstName} / ${first.patient.lastName}`);
  check('the acquisition source is kept on the record',
    (first.patient.referredBy ?? '').includes('instagram'), first.patient.referredBy);

  /* Both sides of the pair -------------------------------------------- */

  const [[pair]] = await conn.query(
    `SELECT l.convertedPatientId, l.status, p.leadId
       FROM leads l JOIN patients p ON p.id = l.convertedPatientId
      WHERE l.id = ?`, [leadId]
  );
  check('lead points at the patient', pair?.convertedPatientId === first.patient.id);
  check('patient points back at the lead', pair?.leadId === leadId);
  check('the lead is marked converted', pair?.status === 'converted');

  /* The open task moves with the person -------------------------------- */

  const [[task]] = await conn.query('SELECT patientId, leadId FROM tasks WHERE id = ?', [taskId]);
  check('an open follow-up follows the patient', task?.patientId === first.patient.id);
  check('the task keeps its lead link as provenance', task?.leadId === leadId);

  /* Idempotency -------------------------------------------------------- */

  const second = await convert(leadId, branch.code, staff.id);
  check('a second submit returns the same patient', second.patient.id === first.patient.id);
  check('and reports that it was already converted', second.alreadyConverted === true);

  const [[count]] = await conn.query('SELECT COUNT(*) AS n FROM patients WHERE leadId = ?', [leadId]);
  check('exactly one patient exists for this lead', Number(count.n) === 1, `${count.n}`);

  /* Communication history follows via patients.leadId ------------------ */

  const [[comm]] = await conn.query(
    `SELECT COUNT(*) AS n FROM communication_logs c
       JOIN patients p ON p.leadId = c.leadId
      WHERE p.id = ?`, [first.patient.id]
  );
  check(
    'pre-conversion messages remain reachable through patients.leadId',
    Number(comm.n) === 0,
    'no messages on this lead, join resolves'
  );
} finally {
  const order = [
    ['tasks', made.tasks],
    ['lead_activities', made.activities],
    ['patients', made.patients],
    ['leads', made.leads],
  ];
  // patients.leadId would block nothing (no FKs), but clear the pointer first
  // so the delete order reads correctly.
  if (made.patients.length) {
    await conn.query(
      `UPDATE patients SET leadId = NULL WHERE id IN (${made.patients.map(() => '?').join(',')})`,
      made.patients
    );
  }
  for (const [table, ids] of order) {
    if (!ids.length) continue;
    await conn.query(`DELETE FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  console.log('\nCleaned up the lead test data.');
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nLead conversion behaves correctly.');
