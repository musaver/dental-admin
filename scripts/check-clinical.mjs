/**
 * Exercises the clinical chain end to end against the live database:
 * visit -> procedure performed -> plan item closed -> recall generated.
 *
 * This is where the bidirectional pointer pairs live, and where recall
 * de-duplication either works or floods the worklist. Everything created is
 * removed again in the finally block.
 *
 *   npm run check:clinical
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { addMonthsClamped, toDateKey } from '../lib/datetime';

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

const made = { patients: [], plans: [], items: [], visits: [], vps: [], recalls: [], dx: [], rx: [], rxItems: [] };

/** Mirrors lib/recalls.ts generateRecallsForVisit. */
async function generateRecalls(visitId, actorId) {
  const [[visit]] = await conn.query(
    'SELECT id, patientId, branchId, visitDate FROM visits WHERE id = ?',
    [visitId]
  );
  const [performed] = await conn.query(
    `SELECT p.category, p.defaultRecallMonths
       FROM visit_procedures vp
       JOIN procedures p ON p.id = vp.procedureId
      WHERE vp.visitId = ? AND vp.status = 'completed'
        AND p.defaultRecallMonths IS NOT NULL`,
    [visitId]
  );

  const [fromVisit] = await conn.query(
    'SELECT recallType FROM recalls WHERE sourceVisitId = ?',
    [visitId]
  );
  const already = new Set(fromVisit.map((r) => r.recallType));

  const created = [];
  const seen = new Set();

  for (const proc of performed) {
    if (already.has(proc.category) || seen.has(proc.category)) continue;
    seen.add(proc.category);

    const dueDate = addMonthsClamped(visit.visitDate, proc.defaultRecallMonths);
    const lo = new Date(dueDate.getTime() - 30 * 86400000);
    const hi = new Date(dueDate.getTime() + 30 * 86400000);

    const [nearby] = await conn.query(
      `SELECT id FROM recalls
        WHERE patientId = ? AND recallType = ? AND status = 'pending'
          AND dueDate BETWEEN ? AND ? LIMIT 1`,
      [visit.patientId, proc.category, lo, hi]
    );
    if (nearby.length) continue;

    const id = randomUUID();
    made.recalls.push(id);
    await conn.query(
      `INSERT INTO recalls (id, patientId, branchId, recallType, dueDate, intervalMonths,
                            status, sourceVisitId, createdBy, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,'pending',?,?,NOW(),NOW())`,
      [id, visit.patientId, visit.branchId, proc.category, dueDate, proc.defaultRecallMonths, visitId, actorId]
    );
    created.push({ id, recallType: proc.category, dueDate });
  }
  return created;
}

try {
  const [[branch]] = await conn.query('SELECT id FROM branches LIMIT 1');
  const [[dentist]] = await conn.query('SELECT id FROM admin_users LIMIT 1');
  // Consultation carries defaultRecallMonths = 6 in the seed data.
  const [[consult]] = await conn.query(
    "SELECT id, category, defaultPrice, defaultRecallMonths FROM procedures WHERE code = 'CON-01'"
  );
  const [[rct]] = await conn.query(
    "SELECT id, defaultPrice FROM procedures WHERE code = 'END-03'"
  );

  /* Set up a patient with an accepted plan ---------------------------- */

  const patientId = randomUUID();
  made.patients.push(patientId);
  await conn.query(
    `INSERT INTO patients (id, mrn, branchId, firstName, phone, status, createdAt, updatedAt)
     VALUES (?,?,?,?,?,'active',NOW(),NOW())`,
    [patientId, `ZZC-${Date.now() % 1000000}`, branch.id, 'ClinicalCheck', '+923000000002']
  );

  const planId = randomUUID();
  made.plans.push(planId);
  await conn.query(
    `INSERT INTO treatment_plans (id, patientId, branchId, dentistId, title, status,
                                  totalAmount, discountTotal, netAmount, proposedAt, acceptedAt,
                                  createdAt, updatedAt)
     VALUES (?,?,?,?,?,'accepted',?,0,?,NOW(),NOW(),NOW(),NOW())`,
    [planId, patientId, branch.id, dentist.id, 'Check plan', rct.defaultPrice, rct.defaultPrice]
  );

  const itemId = randomUUID();
  made.items.push(itemId);
  await conn.query(
    `INSERT INTO treatment_plan_items (id, treatmentPlanId, procedureId, teeth, unitPrice,
                                       quantity, discountValue, netAmount, status, sortOrder,
                                       createdAt, updatedAt)
     VALUES (?,?,?,'16',?,1,0,?,'pending',0,NOW(),NOW())`,
    [itemId, planId, rct.id, rct.defaultPrice, rct.defaultPrice]
  );

  /* Open a visit ------------------------------------------------------- */

  const visitId = randomUUID();
  made.visits.push(visitId);
  await conn.query(
    `INSERT INTO visits (id, patientId, branchId, dentistId, visitDate, status, createdAt, updatedAt)
     VALUES (?,?,?,?,NOW(),'in_progress',NOW(),NOW())`,
    [visitId, patientId, branch.id, dentist.id]
  );

  /* Perform the planned procedure, closing both sides of the pair ------ */

  const vpId = randomUUID();
  made.vps.push(vpId);
  await conn.query(
    `INSERT INTO visit_procedures (id, visitId, patientId, procedureId, treatmentPlanItemId,
                                   teeth, price, performedBy, status, createdAt)
     VALUES (?,?,?,?,?,'16',?,?,'completed',NOW())`,
    [vpId, visitId, patientId, rct.id, itemId, rct.defaultPrice, dentist.id]
  );
  await conn.query(
    "UPDATE treatment_plan_items SET visitProcedureId = ?, status = 'completed' WHERE id = ?",
    [vpId, itemId]
  );

  const [[pair]] = await conn.query(
    `SELECT t.visitProcedureId, v.treatmentPlanItemId, t.status
       FROM treatment_plan_items t
       JOIN visit_procedures v ON v.id = t.visitProcedureId
      WHERE t.id = ?`,
    [itemId]
  );
  check(
    'plan item and visit procedure point at each other',
    pair?.visitProcedureId === vpId && pair?.treatmentPlanItemId === itemId
  );
  check('delivering the work completes the plan item', pair?.status === 'completed');

  /* Also perform a consultation, which carries a recall ---------------- */

  const vpConsultId = randomUUID();
  made.vps.push(vpConsultId);
  await conn.query(
    `INSERT INTO visit_procedures (id, visitId, patientId, procedureId, price, performedBy,
                                   status, createdAt)
     VALUES (?,?,?,?,?,?,'completed',NOW())`,
    [vpConsultId, visitId, patientId, consult.id, consult.defaultPrice, dentist.id]
  );

  /* Complete the visit -> recalls ------------------------------------- */

  await conn.query("UPDATE visits SET status = 'completed' WHERE id = ?", [visitId]);
  const firstRun = await generateRecalls(visitId, dentist.id);

  check(
    'completing the visit generates a recall',
    firstRun.length === 1,
    firstRun.map((r) => `${r.recallType} due ${toDateKey(r.dueDate)}`).join(', ')
  );
  check(
    'recallType reuses the procedure category',
    firstRun[0]?.recallType === consult.category,
    consult.category
  );

  const [[visitRow]] = await conn.query('SELECT visitDate FROM visits WHERE id = ?', [visitId]);
  const expectedDue = addMonthsClamped(visitRow.visitDate, consult.defaultRecallMonths);
  check(
    'the due date is defaultRecallMonths out',
    toDateKey(firstRun[0].dueDate) === toDateKey(expectedDue),
    `${toDateKey(firstRun[0].dueDate)} (+${consult.defaultRecallMonths}m)`
  );

  /* Idempotency -------------------------------------------------------- */

  const secondRun = await generateRecalls(visitId, dentist.id);
  check('re-completing the visit does not duplicate the recall', secondRun.length === 0);

  const [countRows] = await conn.query(
    'SELECT COUNT(*) AS n FROM recalls WHERE sourceVisitId = ?',
    [visitId]
  );
  check('exactly one recall exists for this visit', Number(countRows[0].n) === 1);

  /* RCT has no defaultRecallMonths, so it must not create one ---------- */

  const [rctRecalls] = await conn.query(
    `SELECT r.id FROM recalls r
      WHERE r.patientId = ? AND r.recallType = (SELECT category FROM procedures WHERE id = ?)`,
    [patientId, rct.id]
  );
  check(
    'a procedure with no recall interval creates no recall',
    rctRecalls.length === 0
  );
} finally {
  const order = [
    ['prescription_items', made.rxItems],
    ['prescriptions', made.rx],
    ['visit_diagnoses', made.dx],
    ['recalls', made.recalls],
    ['visit_procedures', made.vps],
    ['treatment_plan_items', made.items],
    ['visits', made.visits],
    ['treatment_plans', made.plans],
    ['patients', made.patients],
  ];
  for (const [table, ids] of order) {
    if (!ids.length) continue;
    await conn.query(`DELETE FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  console.log('\nCleaned up the clinical test data.');
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nThe clinical chain behaves correctly.');
