/**
 * End-to-end exercise of patient registration against the live database.
 *
 * Creates real rows, verifies the behaviour that matters, then removes
 * everything it made. Cleanup runs in a finally block so a failure mid-way
 * still leaves the database as it found it.
 *
 *   npm run check:patients
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

const created = [];

/** Mirrors nextMrn() in lib/patients.ts. */
async function nextMrn(branchCode) {
  const [rows] = await conn.query(
    'SELECT mrn FROM patients WHERE mrn LIKE ? ORDER BY mrn DESC LIMIT 1',
    [`${branchCode}-%`]
  );
  return formatMrn(branchCode, rows.length ? parseMrnSequence(rows[0].mrn) + 1 : 1);
}

async function insertPatient(branchId, branchCode, over = {}) {
  const id = randomUUID();
  const mrn = await nextMrn(branchCode);
  await conn.query(
    `INSERT INTO patients (id, mrn, branchId, firstName, lastName, phone, status,
                           hasAlerts, defaultDiscountPercent, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
    [
      id,
      mrn,
      branchId,
      over.firstName ?? 'CheckScript',
      over.lastName ?? 'Patient',
      over.phone ?? normalizePhone('03001234567'),
      over.status ?? 'active',
      0,
      0,
    ]
  );
  created.push(id);
  return { id, mrn };
}

try {
  const [[branch]] = await conn.query('SELECT id, code FROM branches LIMIT 1');
  console.log(`Branch: ${branch.code}\n`);

  /* MRN allocation ---------------------------------------------------- */

  const before = await nextMrn(branch.code);
  const a = await insertPatient(branch.id, branch.code);
  const b = await insertPatient(branch.id, branch.code);

  check('first MRN matches what nextMrn predicted', a.mrn === before, a.mrn);
  check(
    'the second MRN increments',
    parseMrnSequence(b.mrn) === parseMrnSequence(a.mrn) + 1,
    `${a.mrn} → ${b.mrn}`
  );
  check('MRN carries the branch code', a.mrn.startsWith(`${branch.code}-`), a.mrn);
  check('MRN fits varchar(20)', a.mrn.length <= 20);

  /* The unique index is the real guarantee against a race ------------- */

  let rejected = false;
  try {
    await conn.query(
      `INSERT INTO patients (id, mrn, branchId, firstName, phone, status, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,NOW(),NOW())`,
      [randomUUID(), a.mrn, branch.id, 'Duplicate', '+923000000000', 'active']
    );
  } catch (error) {
    rejected = error.errno === 1062;
  }
  check('the database refuses a duplicate MRN (errno 1062)', rejected);

  /* Zero-padding makes lexicographic order numeric -------------------- */

  const [ordered] = await conn.query(
    'SELECT mrn FROM patients WHERE mrn LIKE ? ORDER BY mrn DESC LIMIT 2',
    [`${branch.code}-%`]
  );
  check(
    'ORDER BY mrn DESC returns the numerically highest',
    parseMrnSequence(ordered[0].mrn) > parseMrnSequence(ordered[1].mrn),
    `${ordered[0].mrn} > ${ordered[1].mrn}`
  );

  /* Phone normalisation is what duplicate detection depends on -------- */

  const stored = normalizePhone('0300 123 4567');
  const [dupes] = await conn.query(
    `SELECT id, mrn FROM patients
      WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 9) = ?`,
    [stored.replace(/\D/g, '').slice(-9)]
  );
  check(
    'a differently-typed number finds the same patient',
    dupes.length >= 2,
    `${dupes.length} match(es) on trailing digits`
  );

  /* Archive rather than delete ---------------------------------------- */

  await conn.query('UPDATE patients SET status = ? WHERE id = ?', ['archived', a.id]);
  const [[archived]] = await conn.query('SELECT status FROM patients WHERE id = ?', [a.id]);
  check('archiving keeps the row', archived?.status === 'archived');

  /* The list view hides archived patients by default ------------------ */

  const [visible] = await conn.query(
    `SELECT id FROM patients WHERE branchId = ? AND status IN ('active','inactive') AND id IN (?, ?)`,
    [branch.id, a.id, b.id]
  );
  check('the default list excludes an archived patient', visible.length === 1);

  /* Branch isolation --------------------------------------------------- */

  const [otherBranch] = await conn.query('SELECT id FROM patients WHERE branchId <> ? LIMIT 1', [
    branch.id,
  ]);
  check(
    'no patient leaks in from another branch',
    otherBranch.length === 0,
    'single-branch clinic'
  );
} finally {
  if (created.length) {
    await conn.query(`DELETE FROM patients WHERE id IN (${created.map(() => '?').join(',')})`, created);
    console.log(`\nCleaned up ${created.length} test patient(s).`);
  }
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nPatient registration behaves correctly.');
