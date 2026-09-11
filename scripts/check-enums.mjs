/**
 * Guards the two ways a controlled vocabulary can silently break.
 *
 * 1. WIDTH — every column here is a bare varchar with no CHECK constraint. A
 *    value longer than the column throws at INSERT time in MySQL strict mode:
 *    in production, midway through a clinical save. Catch it here instead.
 *
 * 2. DRIFT — the 31 permission slugs live in `admin_roles.permissions` on the
 *    live database. If lib/permissions.ts and those rows disagree, roles
 *    silently grant nothing.
 *
 * Read-only.
 *
 *   npm run check:enums
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import * as E from '../lib/enums';
import { ALL_PERMISSIONS, parsePermissions } from '../lib/permissions';

/** vocabulary -> the column it is stored in */
const COLUMN_OF = [
  [E.APPOINTMENT_STATUS, 'appointments', 'status'],
  [E.APPOINTMENT_TYPE, 'appointments', 'type'],
  [E.RECALL_STATUS, 'recalls', 'status'],
  [E.RECALL_TYPE, 'recalls', 'recallType'],
  [E.VISIT_STATUS, 'visits', 'status'],
  [E.VISIT_PROCEDURE_STATUS, 'visit_procedures', 'status'],
  [E.TOOTH_CONDITION_STATUS, 'tooth_conditions', 'status'],
  [E.TOOTH_CONDITION_TYPE, 'tooth_conditions', 'conditionType'],
  [E.PATIENT_CONDITION_TYPE, 'patient_conditions', 'conditionType'],
  [E.CONDITION_SEVERITY, 'patient_conditions', 'severity'],
  [E.PATIENT_CONDITION_STATUS, 'patient_conditions', 'status'],
  [E.TREATMENT_PLAN_STATUS, 'treatment_plans', 'status'],
  [E.TREATMENT_PLAN_ITEM_STATUS, 'treatment_plan_items', 'status'],
  [E.DISCOUNT_TYPE, 'treatment_plan_items', 'discountType'],
  [E.DISCOUNT_TYPE, 'discount_codes', 'discountType'],
  [E.PROCEDURE_CATEGORY, 'procedures', 'category'],
  [E.INVOICE_STATUS, 'invoices', 'status'],
  [E.INVOICE_ITEM_TYPE, 'invoice_items', 'itemType'],
  [E.PAYMENT_TYPE, 'payments', 'type'],
  [E.PAYMENT_METHOD, 'payments', 'method'],
  [E.PATIENT_STATUS, 'patients', 'status'],
  [E.GENDER, 'patients', 'gender'],
  [E.FILE_TYPE, 'patient_files', 'fileType'],
  [E.PHOTO_STAGE, 'patient_files', 'photoStage'],
  [E.LEAD_STATUS, 'leads', 'status'],
  [E.LEAD_SOURCE, 'leads', 'source'],
  [E.LEAD_ACTIVITY_TYPE, 'lead_activities', 'activityType'],
  [E.LEAD_ACTIVITY_OUTCOME, 'lead_activities', 'outcome'],
  [E.COMM_CHANNEL, 'communication_logs', 'channel'],
  [E.COMM_DIRECTION, 'communication_logs', 'direction'],
  [E.COMM_STATUS, 'communication_logs', 'status'],
  [E.COMM_REFERENCE_TYPE, 'communication_logs', 'referenceType'],
  [E.TASK_STATUS, 'tasks', 'status'],
  [E.TASK_PRIORITY, 'tasks', 'priority'],
  [E.AUTHOR_TYPE, 'task_comments', 'authorType'],
  [E.NOTIFICATION_USER_TYPE, 'notifications', 'userType'],
  [E.STAFF_TYPE, 'admin_users', 'staffType'],
  [E.AUDIT_ACTION, 'audit_logs', 'action'],
  [E.AUDIT_ENTITY, 'audit_logs', 'entityType'],
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

let problems = 0;
const fail = (msg) => {
  problems++;
  console.log(`  FAIL  ${msg}`);
};

/* 1. Widths ---------------------------------------------------------- */

const [columns] = await conn.execute(
  `SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ?`,
  [process.env.DB_NAME]
);
const widthOf = new Map(
  columns.map((c) => [`${c.TABLE_NAME}.${c.COLUMN_NAME}`, c.CHARACTER_MAXIMUM_LENGTH])
);

let checked = 0;
for (const [vocab, table, column] of COLUMN_OF) {
  const key = `${table}.${column}`;
  const width = widthOf.get(key);
  if (width == null) {
    fail(`${key} does not exist in the database`);
    continue;
  }
  for (const value of Object.values(vocab)) {
    checked++;
    if (String(value).length > width) {
      fail(`${key} is varchar(${width}) but "${value}" is ${String(value).length} chars`);
    }
  }
}

// BLOOD_GROUP is an array, not a keyed object.
const bgWidth = widthOf.get('patients.bloodGroup');
for (const value of E.BLOOD_GROUP) {
  checked++;
  if (value.length > bgWidth) {
    fail(`patients.bloodGroup is varchar(${bgWidth}) but "${value}" is ${value.length} chars`);
  }
}

console.log(`  ok    ${checked} vocabulary values fit their columns`);

/* 2. Values already in the database must be known -------------------- */

for (const [vocab, table, column] of COLUMN_OF) {
  const known = new Set(Object.values(vocab).map(String));
  const [rows] = await conn.execute(
    `SELECT DISTINCT \`${column}\` AS v FROM \`${table}\` WHERE \`${column}\` IS NOT NULL`
  );
  for (const { v } of rows) {
    if (!known.has(String(v))) {
      fail(`${table}.${column} holds "${v}", which lib/enums.ts does not define`);
    }
  }
}
console.log('  ok    no stored value is missing from lib/enums.ts');

/* 3. Permission slugs must match the seeded roles -------------------- */

const [roles] = await conn.execute('SELECT name, permissions FROM admin_roles');
const declared = new Set(ALL_PERMISSIONS);
const stored = new Set();

for (const role of roles) {
  const parsed = parsePermissions(role.permissions);
  // parsePermissions drops unknown slugs, so compare against the raw array too.
  let raw = [];
  try {
    raw = JSON.parse(role.permissions ?? '[]');
  } catch {
    fail(`role "${role.name}" has permissions that are not valid JSON`);
  }
  for (const slug of raw) stored.add(slug);
  const dropped = raw.filter((s) => !declared.has(s));
  if (dropped.length) {
    fail(`role "${role.name}" holds unknown slug(s): ${dropped.join(', ')}`);
  }
  if (parsed.length !== raw.length) {
    fail(`role "${role.name}": ${raw.length - parsed.length} slug(s) were dropped on parse`);
  }
}

const unused = [...declared].filter((s) => !stored.has(s));
if (unused.length) {
  console.log(`  note  ${unused.length} declared slug(s) held by no role: ${unused.join(', ')}`);
}
console.log(`  ok    ${stored.size} slugs across ${roles.length} roles all recognised`);

await conn.end();

if (problems) {
  console.log(`\n${problems} problem(s) found.`);
  process.exit(1);
}
console.log('\nVocabularies are consistent with the database.');
