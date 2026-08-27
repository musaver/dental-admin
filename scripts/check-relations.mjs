/**
 * Verifies that every relation declared in lib/relations.ts actually resolves.
 *
 * TypeScript cannot catch a mismatched `relationName`: Drizzle only rejects an
 * unpaired relation when it BUILDS the query. This script issues one
 * `findMany({ limit: 1, with: … })` per table so a broken pairing surfaces
 * here rather than in a route at runtime.
 *
 * Read-only. Safe against the live database — it selects at most one row per
 * table and writes nothing.
 *
 *   npm run check:relations
 *
 * Run through jiti — these scripts import lib/*.ts with extensionless
 * specifiers, which Node's raw ESM resolver rejects.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from '../lib/schema';
import * as relations from '../lib/relations';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 3306,
  ssl: { rejectUnauthorized: false },
  timezone: 'Z',
});

const db = drizzle(pool, { schema: { ...schema, ...relations }, mode: 'default' });

const PROBES = {
  patients: {
    branch: true, registeredByStaff: true, portalUser: true, lead: true,
    conditions: true, toothConditions: true, files: true, appointments: true,
    visits: true, treatmentPlans: true, prescriptions: true, invoices: true,
    payments: true, recalls: true, communications: true, tasks: true,
    visitDiagnoses: true, visitProcedures: true,
  },
  // Three separate links to admin_users, plus both bidirectional pairs.
  appointments: {
    patient: true, branch: true, chair: true, dentist: true,
    createdByStaff: true, cancelledByStaff: true,
    treatmentPlanItem: true, recall: true, visits: true,
  },
  // Two separate links to visits (charted at / resolved at).
  visits: {
    patient: true, branch: true, appointment: true, dentist: true,
    procedures: true, diagnoses: true, prescriptions: true, files: true,
    invoices: true, chartedToothConditions: true, resolvedToothConditions: true,
  },
  toothConditions: {
    patient: true, visit: true, resolvedByVisit: true, diagnosis: true,
    treatmentPlanItem: true, recordedByStaff: true,
  },
  treatmentPlanItems: {
    treatmentPlan: true, procedure: true, toothCondition: true,
    appointment: true, visitProcedure: true, invoiceItems: true,
  },
  treatmentPlans: {
    patient: true, branch: true, dentist: true, consentFile: true,
    items: true, invoices: true,
  },
  visitProcedures: {
    visit: true, patient: true, procedure: true, treatmentPlanItem: true,
    performedByStaff: true, invoiceItems: true,
  },
  visitDiagnoses: { visit: true, patient: true, toothConditions: true },
  prescriptions: { visit: true, patient: true, dentist: true, items: true },
  prescriptionItems: { prescription: true },
  invoices: {
    patient: true, branch: true, visit: true, treatmentPlan: true,
    createdByStaff: true, items: true, payments: true,
  },
  invoiceItems: {
    invoice: true, procedure: true, visitProcedure: true, treatmentPlanItem: true,
  },
  payments: { patient: true, branch: true, invoice: true, recordedByStaff: true },
  leads: {
    branch: true, interestedProcedure: true, assignedToStaff: true,
    createdByStaff: true, convertedPatient: true, activities: true,
    communications: true, tasks: true,
  },
  leadActivities: { lead: true, performedByStaff: true },
  communicationLogs: { patient: true, lead: true, performedByStaff: true },
  recalls: {
    patient: true, branch: true, appointment: true, sourceVisit: true,
    createdByStaff: true,
  },
  tasks: {
    patient: true, lead: true, branch: true, assignedToStaff: true,
    createdByStaff: true, comments: true,
  },
  taskComments: { task: true },
  adminUsers: {
    role: true, branch: true, schedules: true, timeOff: true,
    appointmentsAsDentist: true, visitsAsDentist: true,
    treatmentPlansAsDentist: true, prescriptions: true,
    assignedTasks: true, assignedLeads: true, auditEntries: true,
  },
  adminRoles: { adminUsers: true },
  procedures: {
    treatmentPlanItems: true, visitProcedures: true,
    invoiceItems: true, interestedLeads: true,
  },
  branches: {
    adminUsers: true, chairs: true, patients: true, appointments: true,
    visits: true, invoices: true, payments: true, leads: true,
    recalls: true, treatmentPlans: true, staffSchedules: true, tasks: true,
  },
  chairs: { branch: true, appointments: true },
  staffSchedules: { staff: true, branch: true },
  staffTimeOff: { staff: true },
  patientConditions: { patient: true, recordedByStaff: true },
  patientFiles: { patient: true, visit: true, uploadedByStaff: true },
  auditLogs: { actor: true, patient: true },
  notifications: { recipient: true },
  user: { accounts: true, sessions: true, patients: true },
  account: { user: true },
  sessions: { user: true },
  messageTemplates: { branch: true, updatedByStaff: true },
  userPreferences: { adminUser: true },
};

let failed = 0;

for (const [table, withClause] of Object.entries(PROBES)) {
  try {
    await db.query[table].findMany({ limit: 1, with: withClause });
    console.log(`  ok    ${table} (${Object.keys(withClause).length} relations)`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${table}`);
    console.log(`        ${String(error.message).split('\n')[0]}`);
  }
}

await pool.end();

const total = Object.keys(PROBES).length;
if (failed) {
  console.log(`\n${failed} of ${total} tables have broken relations.`);
  process.exit(1);
}
console.log(`\nAll ${total} tables resolved their relations cleanly.`);
