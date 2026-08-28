/**
 * Removes rows whose parent no longer exists.
 *
 * With no foreign keys, deleting a parent leaves its children behind pointing
 * at nothing. Those rows are unreachable through the UI but still counted by
 * reports, so they quietly distort totals.
 *
 * DRY RUN BY DEFAULT — prints what it would delete and changes nothing:
 *
 *   node scripts/repair-orphans.mjs
 *   node scripts/repair-orphans.mjs --apply
 *
 * Deletion order is child-first, so removing one orphan cannot orphan another.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const APPLY = process.argv.includes('--apply');

/** child table, its pointer column, the parent table it should reach. */
const ORPHAN_RULES = [
  ['prescription_items', 'prescriptionId', 'prescriptions'],
  ['prescriptions', 'visitId', 'visits'],
  ['visit_diagnoses', 'visitId', 'visits'],
  ['visit_procedures', 'visitId', 'visits'],
  ['invoice_items', 'invoiceId', 'invoices'],
  ['treatment_plan_items', 'treatmentPlanId', 'treatment_plans'],
  ['tooth_conditions', 'patientId', 'patients'],
  ['patient_conditions', 'patientId', 'patients'],
  ['patient_files', 'patientId', 'patients'],
  ['lead_activities', 'leadId', 'leads'],
  ['task_comments', 'taskId', 'tasks'],
  ['visits', 'patientId', 'patients'],
  ['appointments', 'patientId', 'patients'],
  ['invoices', 'patientId', 'patients'],
  ['payments', 'patientId', 'patients'],
  ['recalls', 'patientId', 'patients'],
];

/**
 * Pointers that should be NULLED rather than deleting the row — the row is
 * still valid, it has merely lost an optional association.
 */
const NULLABLE_RULES = [
  ['treatment_plan_items', 'visitProcedureId', 'visit_procedures'],
  ['treatment_plan_items', 'appointmentId', 'appointments'],
  ['treatment_plan_items', 'toothConditionId', 'tooth_conditions'],
  ['appointments', 'treatmentPlanItemId', 'treatment_plan_items'],
  ['appointments', 'recallId', 'recalls'],
  ['appointments', 'chairId', 'chairs'],
  ['recalls', 'appointmentId', 'appointments'],
  ['recalls', 'sourceVisitId', 'visits'],
  ['tooth_conditions', 'visitId', 'visits'],
  ['tooth_conditions', 'resolvedByVisitId', 'visits'],
  ['tooth_conditions', 'diagnosisId', 'visit_diagnoses'],
  ['patient_files', 'visitId', 'visits'],
  ['invoices', 'visitId', 'visits'],
  ['invoices', 'treatmentPlanId', 'treatment_plans'],
  ['payments', 'invoiceId', 'invoices'],
  ['communication_logs', 'leadId', 'leads'],
  ['communication_logs', 'patientId', 'patients'],
  ['patients', 'leadId', 'leads'],
  ['leads', 'convertedPatientId', 'patients'],
];

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  timezone: 'Z',
});

let toDelete = 0;
let toNull = 0;

console.log(APPLY ? 'APPLYING changes.\n' : 'Dry run — nothing will be changed.\n');

console.log('Orphaned rows (parent missing → delete the row):');
for (const [table, column, parent] of ORPHAN_RULES) {
  const [rows] = await conn.query(
    `SELECT c.id FROM \`${table}\` c
       LEFT JOIN \`${parent}\` p ON p.id = c.\`${column}\`
      WHERE c.\`${column}\` IS NOT NULL AND p.id IS NULL`
  );
  if (!rows.length) continue;

  toDelete += rows.length;
  console.log(`  ${table}.${column} → ${parent}: ${rows.length} orphan(s)`);
  for (const r of rows.slice(0, 3)) console.log(`      ${r.id}`);

  if (APPLY) {
    const [result] = await conn.query(
      `DELETE c FROM \`${table}\` c
         LEFT JOIN \`${parent}\` p ON p.id = c.\`${column}\`
        WHERE c.\`${column}\` IS NOT NULL AND p.id IS NULL`
    );
    console.log(`      deleted ${result.affectedRows}`);
  }
}
if (!toDelete) console.log('  none');

console.log('\nDangling optional pointers (row is fine → set the column NULL):');
for (const [table, column, parent] of NULLABLE_RULES) {
  const [rows] = await conn.query(
    `SELECT c.id FROM \`${table}\` c
       LEFT JOIN \`${parent}\` p ON p.id = c.\`${column}\`
      WHERE c.\`${column}\` IS NOT NULL AND p.id IS NULL`
  );
  if (!rows.length) continue;

  toNull += rows.length;
  console.log(`  ${table}.${column} → ${parent}: ${rows.length} dangling`);
  for (const r of rows.slice(0, 3)) console.log(`      ${r.id}`);

  if (APPLY) {
    const [result] = await conn.query(
      `UPDATE \`${table}\` c
         LEFT JOIN \`${parent}\` p ON p.id = c.\`${column}\`
          SET c.\`${column}\` = NULL
        WHERE c.\`${column}\` IS NOT NULL AND p.id IS NULL`
    );
    console.log(`      cleared ${result.affectedRows}`);
  }
}
if (!toNull) console.log('  none');

await conn.end();

console.log(
  `\n${toDelete} row(s) to delete, ${toNull} pointer(s) to clear.` +
    (APPLY || (!toDelete && !toNull) ? '' : '\nRe-run with --apply to make these changes.')
);
