/**
 * Quality checks for the demo dataset.
 *
 * scripts/check-invariants.mjs proves the data is STRUCTURALLY consistent —
 * rollups match their sources, pointer pairs agree, nothing dangles. This
 * proves it is USEFUL: that every screen has something to show, that the
 * diary contains no impossible double-booking, and that the conventions the
 * database cannot express were actually honoured.
 *
 * Read-only.
 *
 *   npm run check:demo
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

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
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failed++;
};

const one = async (sql, params = []) => {
  const [rows] = await conn.query(sql, params);
  return rows[0] ?? {};
};
const many = async (sql, params = []) => {
  const [rows] = await conn.query(sql, params);
  return rows;
};

/* ── Every screen has something to render ─────────────────────────────── */

console.log('Every screen has data:');

const VOLUMES = [
  ['patients', 'patients', 30],
  ['appointments', 'appointments', 200],
  ['visits', 'visits', 100],
  ['visit_procedures', 'procedures performed', 150],
  ['tooth_conditions', 'odontogram entries', 60],
  ['prescriptions', 'prescriptions', 10],
  ['treatment_plans', 'treatment plans', 15],
  ['invoices', 'invoices', 60],
  ['payments', 'payments', 80],
  ['leads', 'leads', 20],
  ['lead_activities', 'lead activities', 40],
  ['recalls', 'recalls', 15],
  ['tasks', 'tasks', 10],
  ['communication_logs', 'messages', 50],
  ['notifications', 'notifications', 20],
  ['audit_logs', 'audit entries', 100],
  ['patient_files', 'patient files', 10],
  ['staff_schedules', 'roster rows', 20],
  ['admin_users', 'staff accounts', 8],
];

for (const [table, label, min] of VOLUMES) {
  const { n } = await one(`SELECT COUNT(*) n FROM \`${table}\``);
  check(`${label} (${n})`, n >= min, n < min ? `expected at least ${min}` : '');
}

/* ── The diary is physically possible ─────────────────────────────────── */

console.log('\nThe diary is bookable:');

// Blocking statuses are the ones that actually hold a slot; cancelled and
// no-show release it, exactly as lib/availability.ts treats them.
const BLOCKING = "('scheduled','confirmed','checked_in','in_progress','completed')";

const chairClash = await many(`
  SELECT a.id, b.id AS other, a.startAt
    FROM appointments a
    JOIN appointments b
      ON b.chairId = a.chairId AND b.id <> a.id
     AND b.startAt < a.endAt AND b.endAt > a.startAt
   WHERE a.chairId IS NOT NULL
     AND a.status IN ${BLOCKING} AND b.status IN ${BLOCKING}
   LIMIT 5`);
check('no two appointments share a chair', chairClash.length === 0,
  chairClash.length ? `${chairClash.length}+ overlaps` : '');

const dentistClash = await many(`
  SELECT a.id, b.id AS other, a.startAt
    FROM appointments a
    JOIN appointments b
      ON b.dentistId = a.dentistId AND b.id <> a.id
     AND b.startAt < a.endAt AND b.endAt > a.startAt
   WHERE a.status IN ${BLOCKING} AND b.status IN ${BLOCKING}
   LIMIT 5`);
check('no dentist is in two places at once', dentistClash.length === 0,
  dentistClash.length ? `${dentistClash.length}+ overlaps` : '');

const backwards = await one('SELECT COUNT(*) n FROM appointments WHERE endAt <= startAt');
check('every appointment ends after it starts', backwards.n === 0);

const sunday = await one('SELECT COUNT(*) n FROM appointments WHERE DAYOFWEEK(startAt) = 1');
check('nothing is booked on a Sunday', sunday.n === 0, sunday.n ? `${sunday.n} on a Sunday` : '');

const outOfHours = await one(`
  SELECT COUNT(*) n FROM appointments
   WHERE HOUR(startAt) < 9 OR (HOUR(endAt) > 21 OR (HOUR(endAt) = 21 AND MINUTE(endAt) > 0))`);
check('everything falls inside clinic hours', outOfHours.n === 0,
  outOfHours.n ? `${outOfHours.n} outside 09:00-21:00` : '');

/* ── Status coverage: every UI branch has an example ──────────────────── */

console.log('\nEvery status the UI renders has an example:');

const COVERAGE = [
  ['appointments', 'status', ['scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show']],
  ['invoices', 'status', ['unpaid', 'partial', 'paid', 'waived', 'refunded']],
  ['payments', 'type', ['payment', 'refund', 'advance']],
  ['treatment_plans', 'status', ['draft', 'proposed', 'accepted', 'in_progress', 'completed', 'rejected']],
  ['leads', 'status', ['new', 'contacted', 'follow_up', 'qualified', 'converted', 'lost']],
  ['recalls', 'status', ['pending', 'contacted', 'booked', 'completed']],
  ['tasks', 'status', ['open', 'in_progress', 'done']],
  ['tooth_conditions', 'status', ['active', 'planned', 'treated', 'watch']],
  ['communication_logs', 'status', ['sent', 'logged', 'skipped']],
  ['visits', 'status', ['in_progress', 'completed']],
  ['patients', 'status', ['active', 'inactive']],
];

for (const [table, column, expected] of COVERAGE) {
  const present = new Set(
    (await many(`SELECT DISTINCT \`${column}\` v FROM \`${table}\``)).map((r) => r.v)
  );
  const missing = expected.filter((v) => !present.has(v));
  check(`${table}.${column}`, missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : `${expected.length} states`);
}

/* ── Today looks alive ────────────────────────────────────────────────── */

console.log("\nToday's clinic:");

const today = await one(`
  SELECT COUNT(*) total,
         SUM(status = 'checked_in')  AS waiting,
         SUM(status = 'in_progress') AS inChair,
         SUM(status = 'completed')   AS done,
         SUM(status IN ('scheduled','confirmed')) AS upcoming
    FROM appointments WHERE DATE(startAt) = DATE(?)`, ['2026-08-28']);
check(`the diary has appointments today (${today.total})`, Number(today.total) > 0);
check(`someone is in the waiting room (${today.waiting ?? 0})`, Number(today.waiting) > 0);
check(`someone is in the chair (${today.inChair ?? 0})`, Number(today.inChair) > 0);
check(`there is work still to come (${today.upcoming ?? 0})`, Number(today.upcoming) > 0);

/* ── Worklists have real work ─────────────────────────────────────────── */

console.log('\nWorklists are not empty:');

const overdueRecalls = await one(
  "SELECT COUNT(*) n FROM recalls WHERE status = 'pending' AND dueDate <= NOW()");
check(`overdue recalls (${overdueRecalls.n})`, overdueRecalls.n > 0);

const dueLeads = await one(`
  SELECT COUNT(*) n FROM leads
   WHERE status IN ('new','contacted','follow_up','qualified')
     AND nextFollowUpAt IS NOT NULL AND nextFollowUpAt <= NOW()`);
check(`leads due a follow-up (${dueLeads.n})`, dueLeads.n > 0);

const overdueInvoices = await one(`
  SELECT COUNT(*) n FROM invoices
   WHERE status IN ('unpaid','partial') AND dueDate IS NOT NULL AND dueDate < NOW()`);
check(`overdue invoices (${overdueInvoices.n})`, overdueInvoices.n > 0);

const overdueTasks = await one(
  "SELECT COUNT(*) n FROM tasks WHERE status = 'open' AND dueDate IS NOT NULL AND dueDate < NOW()");
check(`overdue tasks (${overdueTasks.n})`, overdueTasks.n > 0);

const uninvoiced = await one(`
  SELECT COUNT(*) n FROM visits v
   WHERE v.status = 'completed'
     AND EXISTS (SELECT 1 FROM visit_procedures p WHERE p.visitId = v.id)
     AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.visitId = v.id)`);
check(`completed visits still to bill (${uninvoiced.n})`, uninvoiced.n > 0);

/* ── Conventions the schema cannot enforce ────────────────────────────── */

console.log('\nConventions held:');

const negative = await one('SELECT COUNT(*) n FROM payments WHERE amount <= 0');
check('every payment amount is positive', negative.n === 0,
  negative.n ? 'direction belongs in payments.type' : '');

const badMrn = await many(`
  SELECT p.mrn FROM patients p JOIN branches b ON b.id = p.branchId
   WHERE p.mrn NOT REGEXP CONCAT('^', b.code, '-[0-9]{6}$') LIMIT 5`);
check('every MRN is <BRANCH>-000000', badMrn.length === 0,
  badMrn.length ? badMrn.map((r) => r.mrn).join(', ') : '');

const dupMrn = await one(
  'SELECT COUNT(*) n FROM (SELECT mrn FROM patients GROUP BY mrn HAVING COUNT(*) > 1) d');
check('MRNs are unique', dupMrn.n === 0);

const badInvoice = await many(
  "SELECT invoiceNumber FROM invoices WHERE invoiceNumber NOT REGEXP '^INV-[A-Z]+-[0-9]{4}-[0-9]{5}$' LIMIT 5");
check('every invoice number is INV-BRANCH-YYMM-00000', badInvoice.length === 0,
  badInvoice.length ? badInvoice.map((r) => r.invoiceNumber).join(', ') : '');

const commBoth = await one(`
  SELECT COUNT(*) n FROM communication_logs
   WHERE (patientId IS NULL AND leadId IS NULL)
      OR (patientId IS NOT NULL AND leadId IS NOT NULL)`);
check('every message belongs to a patient XOR a lead', commBoth.n === 0);

const noShowLeak = await one(
  "SELECT COUNT(*) n FROM appointments WHERE status = 'no_show' AND cancelledAt IS NOT NULL");
check('no-shows do not borrow cancelledAt', noShowLeak.n === 0);

const completedNoStamp = await one(
  "SELECT COUNT(*) n FROM appointments WHERE status = 'completed' AND completedAt IS NULL");
check('completed appointments carry completedAt', completedNoStamp.n === 0);

const dupChart = await one(`
  SELECT COUNT(*) n FROM (
    SELECT patientId, toothNumber, conditionType FROM tooth_conditions
     WHERE status = 'active' GROUP BY patientId, toothNumber, conditionType
    HAVING COUNT(*) > 1) d`);
check('the odontogram has no duplicate active findings', dupChart.n === 0);

const badTooth = await one(
  "SELECT COUNT(*) n FROM tooth_conditions WHERE toothNumber NOT REGEXP '^[1-8][1-8]$'");
check('every tooth number is valid FDI', badTooth.n === 0);

const phoneShape = await one(
  "SELECT COUNT(*) n FROM patients WHERE phone NOT LIKE '+92%'");
check('patient phones are normalised to +92', phoneShape.n === 0);

const alertMirror = await one(`
  SELECT COUNT(*) n FROM patients p
   WHERE p.hasAlerts <> (SELECT COUNT(*) > 0 FROM patient_conditions c
                          WHERE c.patientId = p.id AND c.isAlert = 1 AND c.status = 'active')`);
check('hasAlerts mirrors the conditions', alertMirror.n === 0);

/* ── Multi-branch actually works ──────────────────────────────────────── */

console.log('\nMulti-branch:');

const branches = await many(`
  SELECT b.name, b.code,
         (SELECT COUNT(*) FROM patients     WHERE branchId = b.id) AS patients,
         (SELECT COUNT(*) FROM appointments WHERE branchId = b.id) AS appointments,
         (SELECT COUNT(*) FROM invoices     WHERE branchId = b.id) AS invoices
    FROM branches b ORDER BY b.code`);
check('there is more than one branch', branches.length >= 2, `${branches.length} branches`);
for (const b of branches) {
  check(`${b.name} (${b.code}) has its own patients and diary`,
    b.patients > 0 && b.appointments > 0 && b.invoices > 0,
    `${b.patients} patients, ${b.appointments} appointments, ${b.invoices} invoices`);
}

const crossBranch = await many(`
  SELECT a.id FROM appointments a JOIN chairs c ON c.id = a.chairId
   WHERE c.branchId <> a.branchId LIMIT 5`);
check('no appointment uses another branch’s chair', crossBranch.length === 0);

const patientBranchMismatch = await many(`
  SELECT a.id FROM appointments a JOIN patients p ON p.id = a.patientId
   WHERE p.branchId <> a.branchId LIMIT 5`);
check('patients are seen at their own branch', patientBranchMismatch.length === 0);

/* ── Portal and reporting have something to show ──────────────────────── */

console.log('\nPortal and reports:');

const portal = await one('SELECT COUNT(*) n FROM patients WHERE portalUserId IS NOT NULL');
check(`patients with a portal login (${portal.n})`, portal.n >= 5);

const shared = await one(`
  SELECT COUNT(*) n FROM (SELECT portalUserId FROM patients
   WHERE portalUserId IS NOT NULL GROUP BY portalUserId HAVING COUNT(*) > 1) d`);
check('one portal login covers a family', shared.n > 0,
  shared.n ? `${shared.n} shared login` : 'no parent/child link');

const sources = await one("SELECT COUNT(DISTINCT source) n FROM leads");
check(`lead sources for the attribution report (${sources.n})`, sources.n >= 5);

const dentists = await one(`
  SELECT COUNT(DISTINCT performedBy) n FROM visit_procedures`);
check(`production is spread across dentists (${dentists.n})`, dentists.n >= 3);

const months = await one(`
  SELECT COUNT(DISTINCT DATE_FORMAT(paymentDate, '%Y-%m')) n FROM payments`);
check(`collections span several months (${months.n})`, months.n >= 3);

const noShowRate = await one(`
  SELECT ROUND(100 * SUM(status = 'no_show') / NULLIF(COUNT(*), 0)) rate
    FROM appointments WHERE startAt < NOW()`);
check(`the no-show rate is plausible (${noShowRate.rate}%)`,
  noShowRate.rate > 0 && noShowRate.rate < 25);

await conn.end();

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nThe demo dataset is complete and consistent.');
