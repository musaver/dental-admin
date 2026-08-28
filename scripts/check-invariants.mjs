/**
 * Detects drift the database cannot prevent.
 *
 * There are no foreign keys, no triggers and no generated columns here, so
 * seven cached rollups and five bidirectional pointer pairs are maintained
 * purely by application discipline. Discipline fails silently. This finds it.
 *
 * Read-only. Run it after any bulk change, and before trusting a financial
 * report.
 *
 *   npm run check:invariants
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

let problems = 0;

async function expectEmpty(label, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  if (rows.length === 0) {
    console.log(`  ok    ${label}`);
    return;
  }
  problems += rows.length;
  console.log(`  FAIL  ${label} — ${rows.length} row(s)`);
  for (const row of rows.slice(0, 5)) {
    console.log(`          ${JSON.stringify(row)}`);
  }
  if (rows.length > 5) console.log(`          … and ${rows.length - 5} more`);
}

console.log('Denormalised rollups:');

// invoices.paidAmount must equal the signed sum of its payments.
await expectEmpty(
  'invoices.paidAmount matches its payments',
  `SELECT i.id, i.invoiceNumber, i.paidAmount AS storedValue, COALESCE(p.total, 0) AS computedValue
     FROM invoices i
     LEFT JOIN (
       SELECT invoiceId,
              SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END) AS total
         FROM payments WHERE invoiceId IS NOT NULL GROUP BY invoiceId
     ) p ON p.invoiceId = i.id
    WHERE i.paidAmount <> COALESCE(p.total, 0)`
);

// totalAmount must equal the sum of the lines.
await expectEmpty(
  'invoices.totalAmount matches its line items',
  `SELECT i.id, i.invoiceNumber, i.totalAmount AS storedValue, COALESCE(li.total, 0) AS computedValue
     FROM invoices i
     LEFT JOIN (
       SELECT invoiceId, SUM(amount) AS total FROM invoice_items GROUP BY invoiceId
     ) li ON li.invoiceId = i.id
    WHERE i.totalAmount <> COALESCE(li.total, 0)`
);

// The plan invariant: netAmount = totalAmount - discountTotal.
await expectEmpty(
  'treatment_plans.netAmount = totalAmount - discountTotal',
  `SELECT id, title, totalAmount, discountTotal, netAmount
     FROM treatment_plans
    WHERE netAmount <> totalAmount - discountTotal`
);

// The plan rollup must match its (non-cancelled) items.
await expectEmpty(
  'treatment_plans.netAmount matches its items',
  `SELECT tp.id, tp.title, tp.netAmount AS storedValue, COALESCE(ti.total, 0) AS computedValue
     FROM treatment_plans tp
     LEFT JOIN (
       SELECT treatmentPlanId, SUM(netAmount) AS total
         FROM treatment_plan_items
        WHERE status <> 'cancelled'
        GROUP BY treatmentPlanId
     ) ti ON ti.treatmentPlanId = tp.id
    WHERE tp.netAmount <> COALESCE(ti.total, 0)`
);

// patients.hasAlerts must mirror an active alert condition.
await expectEmpty(
  'patients.hasAlerts mirrors patient_conditions',
  `SELECT p.id, p.mrn, p.hasAlerts AS storedValue,
          (SELECT COUNT(*) FROM patient_conditions c
            WHERE c.patientId = p.id AND c.isAlert = 1 AND c.status = 'active') AS activeAlerts
     FROM patients p
    WHERE p.hasAlerts <> (
      (SELECT COUNT(*) FROM patient_conditions c
        WHERE c.patientId = p.id AND c.isAlert = 1 AND c.status = 'active') > 0
    )`
);

console.log('\nBidirectional pointer pairs:');

await expectEmpty(
  'leads.convertedPatientId ↔ patients.leadId',
  `SELECT l.id AS leadId, l.convertedPatientId, p.id AS patientId, p.leadId AS patientLeadId
     FROM leads l
     LEFT JOIN patients p ON p.id = l.convertedPatientId
    WHERE l.convertedPatientId IS NOT NULL
      AND (p.id IS NULL OR p.leadId IS NULL OR p.leadId <> l.id)`
);

await expectEmpty(
  'patients.leadId ↔ leads.convertedPatientId',
  `SELECT p.id AS patientId, p.leadId, l.convertedPatientId
     FROM patients p
     LEFT JOIN leads l ON l.id = p.leadId
    WHERE p.leadId IS NOT NULL
      AND (l.id IS NULL OR l.convertedPatientId IS NULL OR l.convertedPatientId <> p.id)`
);

await expectEmpty(
  'appointments.treatmentPlanItemId ↔ treatment_plan_items.appointmentId',
  `SELECT a.id AS appointmentId, a.treatmentPlanItemId, t.appointmentId AS itemAppointmentId
     FROM appointments a
     LEFT JOIN treatment_plan_items t ON t.id = a.treatmentPlanItemId
    WHERE a.treatmentPlanItemId IS NOT NULL
      AND (t.id IS NULL OR t.appointmentId IS NULL OR t.appointmentId <> a.id)`
);

await expectEmpty(
  'appointments.recallId ↔ recalls.appointmentId',
  `SELECT a.id AS appointmentId, a.recallId, r.appointmentId AS recallAppointmentId
     FROM appointments a
     LEFT JOIN recalls r ON r.id = a.recallId
    WHERE a.recallId IS NOT NULL
      AND (r.id IS NULL OR r.appointmentId IS NULL OR r.appointmentId <> a.id)`
);

await expectEmpty(
  'treatment_plan_items.visitProcedureId ↔ visit_procedures.treatmentPlanItemId',
  `SELECT t.id AS itemId, t.visitProcedureId, v.treatmentPlanItemId
     FROM treatment_plan_items t
     LEFT JOIN visit_procedures v ON v.id = t.visitProcedureId
    WHERE t.visitProcedureId IS NOT NULL
      AND (v.id IS NULL OR v.treatmentPlanItemId IS NULL OR v.treatmentPlanItemId <> t.id)`
);

console.log('\nDangling references (no foreign keys exist to prevent these):');

const DANGLING = [
  ['appointments.patientId', 'appointments', 'patientId', 'patients'],
  ['appointments.dentistId', 'appointments', 'dentistId', 'admin_users'],
  ['appointments.branchId', 'appointments', 'branchId', 'branches'],
  ['appointments.chairId', 'appointments', 'chairId', 'chairs'],
  ['visits.patientId', 'visits', 'patientId', 'patients'],
  ['visit_procedures.visitId', 'visit_procedures', 'visitId', 'visits'],
  ['visit_procedures.procedureId', 'visit_procedures', 'procedureId', 'procedures'],
  ['tooth_conditions.patientId', 'tooth_conditions', 'patientId', 'patients'],
  ['treatment_plans.patientId', 'treatment_plans', 'patientId', 'patients'],
  ['treatment_plan_items.treatmentPlanId', 'treatment_plan_items', 'treatmentPlanId', 'treatment_plans'],
  ['invoices.patientId', 'invoices', 'patientId', 'patients'],
  ['invoice_items.invoiceId', 'invoice_items', 'invoiceId', 'invoices'],
  ['payments.patientId', 'payments', 'patientId', 'patients'],
  ['payments.invoiceId', 'payments', 'invoiceId', 'invoices'],
  ['patient_files.patientId', 'patient_files', 'patientId', 'patients'],
  ['prescriptions.visitId', 'prescriptions', 'visitId', 'visits'],
  ['prescription_items.prescriptionId', 'prescription_items', 'prescriptionId', 'prescriptions'],
  ['recalls.patientId', 'recalls', 'patientId', 'patients'],
  ['lead_activities.leadId', 'lead_activities', 'leadId', 'leads'],
  ['task_comments.taskId', 'task_comments', 'taskId', 'tasks'],
  ['admin_users.roleId', 'admin_users', 'roleId', 'admin_roles'],
  ['admin_users.branchId', 'admin_users', 'branchId', 'branches'],
  ['chairs.branchId', 'chairs', 'branchId', 'branches'],
];

let danglingFound = 0;
for (const [label, table, column, parent] of DANGLING) {
  const [rows] = await conn.query(
    `SELECT c.id FROM \`${table}\` c
       LEFT JOIN \`${parent}\` p ON p.id = c.\`${column}\`
      WHERE c.\`${column}\` IS NOT NULL AND p.id IS NULL
      LIMIT 5`
  );
  if (rows.length) {
    danglingFound += rows.length;
    problems += rows.length;
    console.log(`  FAIL  ${label} → ${parent}: ${rows.length} orphan(s)`);
  }
}
if (!danglingFound) {
  console.log(`  ok    ${DANGLING.length} reference columns, no orphans`);
}

await conn.end();

if (problems) {
  console.log(`\n${problems} inconsistency/inconsistencies found.`);
  process.exit(1);
}
console.log('\nAll invariants hold.');
