/**
 * Exercises treatment-plan money against the live database.
 *
 * The plan rollup is denormalised across four columns with nothing enforcing
 * it, and per-tooth quantity is a 3x billing error waiting to happen — so this
 * builds a real plan, checks the arithmetic, and removes it again.
 *
 *   npm run check:plans
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { computeItemNet, computePlanTotals } from '../lib/money';
import { packTeeth, toothCount } from '../lib/odontogram';

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

const cleanup = { patients: [], plans: [], items: [] };

try {
  const [[branch]] = await conn.query('SELECT id, code FROM branches LIMIT 1');
  const [[dentist]] = await conn.query('SELECT id FROM admin_users LIMIT 1');

  // A per-tooth procedure and a whole-mouth one, from the seeded catalogue.
  const [[perTooth]] = await conn.query(
    "SELECT id, name, defaultPrice FROM procedures WHERE isPerTooth = 1 AND code = 'END-03' LIMIT 1"
  );
  const [[wholeMouth]] = await conn.query(
    "SELECT id, name, defaultPrice FROM procedures WHERE isPerTooth = 0 AND code = 'CON-01' LIMIT 1"
  );
  console.log(`Using: ${perTooth.name} @ ${perTooth.defaultPrice}, ${wholeMouth.name} @ ${wholeMouth.defaultPrice}\n`);

  /* Build a plan ------------------------------------------------------- */

  const patientId = randomUUID();
  cleanup.patients.push(patientId);
  await conn.query(
    `INSERT INTO patients (id, mrn, branchId, firstName, phone, status, createdAt, updatedAt)
     VALUES (?,?,?,?,?,'active',NOW(),NOW())`,
    [patientId, `ZZZ-${Date.now() % 1000000}`, branch.id, 'PlanCheck', '+923000000001']
  );

  const planId = randomUUID();
  cleanup.plans.push(planId);
  await conn.query(
    `INSERT INTO treatment_plans (id, patientId, branchId, dentistId, title, status,
                                  totalAmount, discountTotal, netAmount, createdAt, updatedAt)
     VALUES (?,?,?,?,?,'draft',0,0,0,NOW(),NOW())`,
    [planId, patientId, branch.id, dentist.id, 'Check plan']
  );

  /* Per-tooth quantity ------------------------------------------------- */

  const teeth = packTeeth(['11', '12', '13']);
  const quantity = toothCount(teeth);
  check('three teeth means a quantity of three', quantity === 3, `${teeth} → ${quantity}`);

  const itemA = {
    quantity,
    unitPrice: perTooth.defaultPrice,
    discountType: 'percentage',
    discountValue: 10,
  };
  const netA = computeItemNet(itemA);
  const expectedA = Math.round(3 * perTooth.defaultPrice * 0.9);
  check('a 10% discount applies to the whole line, not one tooth', netA === expectedA, `${netA}`);

  const itemAId = randomUUID();
  cleanup.items.push(itemAId);
  await conn.query(
    `INSERT INTO treatment_plan_items (id, treatmentPlanId, procedureId, teeth, unitPrice,
                                       quantity, discountType, discountValue, netAmount,
                                       status, sortOrder, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,'pending',0,NOW(),NOW())`,
    [itemAId, planId, perTooth.id, teeth, itemA.unitPrice, itemA.quantity,
     itemA.discountType, itemA.discountValue, netA]
  );

  const itemB = { quantity: 1, unitPrice: wholeMouth.defaultPrice };
  const netB = computeItemNet(itemB);
  const itemBId = randomUUID();
  cleanup.items.push(itemBId);
  await conn.query(
    `INSERT INTO treatment_plan_items (id, treatmentPlanId, procedureId, unitPrice, quantity,
                                       discountValue, netAmount, status, sortOrder, createdAt, updatedAt)
     VALUES (?,?,?,?,?,0,?,'pending',1,NOW(),NOW())`,
    [itemBId, planId, wholeMouth.id, itemB.unitPrice, itemB.quantity, netB]
  );

  /* Roll up ------------------------------------------------------------ */

  const totals = computePlanTotals([itemA, itemB]);
  await conn.query(
    'UPDATE treatment_plans SET totalAmount=?, discountTotal=?, netAmount=? WHERE id=?',
    [totals.totalAmount, totals.discountTotal, totals.netAmount, planId]
  );

  check(
    'plan invariant: netAmount = totalAmount − discountTotal',
    totals.netAmount === totals.totalAmount - totals.discountTotal,
    `${totals.netAmount} = ${totals.totalAmount} − ${totals.discountTotal}`
  );

  const [[stored]] = await conn.query(
    'SELECT totalAmount, discountTotal, netAmount FROM treatment_plans WHERE id = ?',
    [planId]
  );
  const [[summed]] = await conn.query(
    `SELECT COALESCE(SUM(netAmount),0) AS total FROM treatment_plan_items
      WHERE treatmentPlanId = ? AND status <> 'cancelled'`,
    [planId]
  );
  check(
    'the stored rollup matches the sum of its items',
    Number(stored.netAmount) === Number(summed.total),
    `${stored.netAmount} vs ${summed.total}`
  );

  /* Cancelled items leave the quote ------------------------------------ */

  await conn.query("UPDATE treatment_plan_items SET status='cancelled' WHERE id=?", [itemBId]);
  const afterCancel = computePlanTotals([itemA, { ...itemB, status: 'cancelled' }]);
  check(
    'a cancelled item drops out of the quoted total',
    afterCancel.netAmount === netA,
    `${afterCancel.netAmount}`
  );

  /* Discount clamping --------------------------------------------------- */

  const silly = computeItemNet({ quantity: 1, unitPrice: 1000, discountType: 'percentage', discountValue: 120 });
  check('a mistyped 120% discount cannot make a line negative', silly === 0, `${silly}`);
} finally {
  if (cleanup.items.length) {
    await conn.query(
      `DELETE FROM treatment_plan_items WHERE id IN (${cleanup.items.map(() => '?').join(',')})`,
      cleanup.items
    );
  }
  if (cleanup.plans.length) {
    await conn.query(
      `DELETE FROM treatment_plans WHERE id IN (${cleanup.plans.map(() => '?').join(',')})`,
      cleanup.plans
    );
  }
  if (cleanup.patients.length) {
    await conn.query(
      `DELETE FROM patients WHERE id IN (${cleanup.patients.map(() => '?').join(',')})`,
      cleanup.patients
    );
  }
  console.log('\nCleaned up the test plan.');
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nTreatment plan arithmetic is correct.');
