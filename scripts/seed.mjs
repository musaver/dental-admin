/**
 * Seeds the clinic with a full set of demo data.
 *
 *   npm run seed -- --reset     wipe existing demo data first (required on re-run)
 *   npm run seed -- --dry       build everything in memory and report, insert nothing
 *
 * What it does NOT touch: admin_roles, procedures, clinic_settings, and the
 * original owner account. Those are the real seeded configuration; everything
 * else is demo data this script owns and can recreate from scratch.
 *
 * The modules in scripts/seed/ build plain row objects against the contract in
 * scripts/seed/context.mjs. This file is the only thing that talks to MySQL.
 * After inserting, it RECOMPUTES every denormalised field from its source rows,
 * so `npm run check:invariants` passes by construction rather than by luck.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { createRows } from './seed/context.mjs';

import buildOrg from './seed/01-org.mjs';
import buildPatients from './seed/02-patients.mjs';
import buildPlans from './seed/03-plans.mjs';
import buildScheduling from './seed/04-scheduling.mjs';
import buildClinical from './seed/05-clinical.mjs';
import buildBilling from './seed/06-billing.mjs';
import buildCrm from './seed/07-crm.mjs';

const RESET = process.argv.includes('--reset');
const DRY = process.argv.includes('--dry');

/* The rows that are configuration, not demo data. Never deleted. */
const KEEP = {
  branchId: '54b330c3-8df1-4b53-8a04-aa820aefcd96',
  ownerId: '185fcba5-e9a4-44c7-aa6b-4a31a1f0116d',
  chairIds: ['fe332cc2-e14f-4fc9-bb9f-8028d477fce0', '15c0f2d0-49e2-4d93-9af9-d666c352f85c'],
};

/**
 * Insert order. Parents first — there are no foreign keys to enforce it, but a
 * failure halfway through is far easier to read when the order is sane.
 */
const INSERT_ORDER = [
  'branches', 'chairs', 'admin_users', 'staff_schedules', 'staff_time_off',
  'message_templates', 'user_preferences',
  'user', 'patients', 'patient_conditions', 'patient_files',
  'treatment_plans', 'treatment_plan_items',
  'appointments', 'recalls',
  'visits', 'visit_procedures', 'visit_diagnoses', 'tooth_conditions',
  'prescriptions', 'prescription_items',
  'invoices', 'invoice_items', 'payments',
  'leads', 'lead_activities', 'tasks', 'task_comments',
  'communication_logs', 'notifications', 'audit_logs',
];

/** Deleted in reverse dependency order by --reset. */
const WIPE_ORDER = [...INSERT_ORDER].reverse();

/** Columns the driver must receive as a JSON string, not an object. */
const JSON_COLUMNS = new Set([
  'leads.metadata', 'audit_logs.before', 'audit_logs.after', 'user_preferences.value',
]);

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  timezone: 'Z',
  multipleStatements: false,
});

/* ── Load the configuration the modules build on top of ───────────────── */

const [branchRows] = await conn.query('SELECT * FROM branches');
const [chairRows] = await conn.query('SELECT * FROM chairs');
const [roleRows] = await conn.query('SELECT id, name FROM admin_roles');
const [procRows] = await conn.query(
  'SELECT id, code, name, category, defaultPrice, durationMinutes, isPerTooth, defaultRecallMonths FROM procedures WHERE isActive = 1'
);
const [ownerRows] = await conn.query('SELECT id, email, name FROM admin_users WHERE id = ?', [KEEP.ownerId]);

if (!branchRows.length || !roleRows.length || !procRows.length) {
  console.error('The clinic configuration is missing (branches / roles / procedures). Aborting.');
  process.exit(1);
}

const mainBranch = branchRows.find((b) => b.id === KEEP.branchId) ?? branchRows[0];
const owner = ownerRows[0];

const world = {
  roles: Object.fromEntries(roleRows.map((r) => [r.name, r.id])),
  procedures: procRows.map((p) => ({
    ...p,
    isPerTooth: Boolean(p.isPerTooth),
  })),
  branches: [{
    id: mainBranch.id, name: mainBranch.name, code: mainBranch.code,
    city: mainBranch.city, isMain: true,
  }],
  chairs: chairRows
    .filter((c) => KEEP.chairIds.includes(c.id))
    .map((c) => ({ id: c.id, branchId: c.branchId, name: c.name })),
  staff: owner
    ? [{
        id: owner.id, name: owner.name, email: owner.email, password: null,
        roleId: roleRows.find((r) => r.name === 'Admin / Owner')?.id,
        roleName: 'Admin / Owner', branchId: null, staffType: 'owner',
        isClinical: true, isActive: true, preexisting: true,
      }]
    : [],
  credentials: [],
  patients: [], portalUsers: [], plans: [], appointments: [], recalls: [],
  visits: [], invoices: [], leads: [], tasks: [],
};

/* ── Guard against seeding on top of existing data ────────────────────── */

const [[{ n: existingPatients }]] = await conn.query('SELECT COUNT(*) n FROM patients');
if (existingPatients > 0 && !RESET && !DRY) {
  console.error(
    `\nThere are already ${existingPatients} patients in this database.\n` +
    `Re-run with --reset to replace the demo data, or --dry to preview.\n` +
    `Nothing was changed.\n`
  );
  await conn.end();
  process.exit(1);
}

/* ── Build ────────────────────────────────────────────────────────────── */

const rows = createRows();
const modules = [
  ['organisation', buildOrg],
  ['patients', buildPatients],
  ['treatment plans', buildPlans],
  ['scheduling', buildScheduling],
  ['clinical', buildClinical],
  ['billing', buildBilling],
  ['CRM', buildCrm],
];

console.log('Building demo data…');
for (const [label, build] of modules) {
  const before = rows.total();
  build(world, rows);
  console.log(`  ${String(rows.total() - before).padStart(5)} rows  ${label}`);
}

/* ── Hash the plaintext passwords the org module left as markers ──────── */

for (const row of rows.all().get('admin_users') ?? []) {
  if (typeof row.password === 'string' && row.password.startsWith('plain:')) {
    row.password = await bcrypt.hash(row.password.slice('plain:'.length), 12);
  }
}

if (DRY) {
  console.log('\nDry run — nothing written. Row counts:');
  for (const table of INSERT_ORDER) {
    if (rows.count(table)) console.log(`  ${String(rows.count(table)).padStart(6)}  ${table}`);
  }
  await conn.end();
  process.exit(0);
}

/* ── Wipe ─────────────────────────────────────────────────────────────── */

if (RESET) {
  console.log('\nRemoving existing demo data…');
  let removed = 0;
  for (const table of WIPE_ORDER) {
    let sql = `DELETE FROM \`${table}\``;
    const params = [];
    if (table === 'admin_users') {
      sql += ' WHERE id <> ?';
      params.push(KEEP.ownerId);
    } else if (table === 'branches') {
      sql += ' WHERE id <> ?';
      params.push(KEEP.branchId);
    } else if (table === 'chairs') {
      sql += ` WHERE id NOT IN (${KEEP.chairIds.map(() => '?').join(',')})`;
      params.push(...KEEP.chairIds);
    }
    const [res] = await conn.query(sql, params);
    removed += res.affectedRows;
  }
  // Login history and portal sessions are demo residue too.
  await conn.query('DELETE FROM login_attempts');
  await conn.query('DELETE FROM sessions');
  await conn.query('DELETE FROM verification_tokens');
  console.log(`  ${removed} rows removed.`);
}

/* ── Insert ───────────────────────────────────────────────────────────── */

/**
 * Rows for one table can legitimately carry different column sets — an
 * appointment that was cancelled has columns a scheduled one does not. Padding
 * the union with NULL would override the schema's DEFAULT (and fail outright on
 * a NOT NULL column), so rows are grouped by their exact shape and each group
 * is inserted with its own column list.
 */
async function insertTable(table, list) {
  const groups = new Map();
  for (const row of list) {
    const keys = Object.keys(row).sort();
    const signature = keys.join('|');
    if (!groups.has(signature)) groups.set(signature, { keys, batch: [] });
    groups.get(signature).batch.push(row);
  }

  let inserted = 0;
  for (const { keys, batch } of groups.values()) {
    const columns = keys.map((k) => `\`${k}\``).join(', ');
    for (let i = 0; i < batch.length; i += 200) {
      const slice = batch.slice(i, i + 200);
      const values = slice.map((row) =>
        keys.map((key) => {
          const value = row[key];
          if (value === undefined) return null;
          if (JSON_COLUMNS.has(`${table}.${key}`) && value !== null && typeof value === 'object') {
            return JSON.stringify(value);
          }
          if (typeof value === 'boolean') return value ? 1 : 0;
          return value;
        })
      );
      await conn.query(`INSERT INTO \`${table}\` (${columns}) VALUES ?`, [values]);
      inserted += slice.length;
    }
  }
  return inserted;
}

console.log('\nInserting…');
const counts = {};
for (const table of INSERT_ORDER) {
  const list = rows.all().get(table);
  if (!list?.length) continue;
  try {
    counts[table] = await insertTable(table, list);
    console.log(`  ${String(counts[table]).padStart(6)}  ${table}`);
  } catch (error) {
    console.error(`\nFailed inserting into ${table}: ${error.message}`);
    if (error.sql) console.error(error.sql.slice(0, 400));
    await conn.end();
    process.exit(1);
  }
}

/* ── Recompute every denormalised field from its source rows ──────────── */

console.log('\nRecomputing denormalised fields…');

// treatment_plan_items.netAmount — the polymorphic discount resolved.
await conn.query(`
  UPDATE treatment_plan_items
     SET netAmount = GREATEST(0, COALESCE(quantity,1) * unitPrice)
                   - LEAST(
                       GREATEST(0, COALESCE(quantity,1) * unitPrice),
                       GREATEST(0, CASE
                         WHEN discountType = 'percentage'
                           THEN ROUND(COALESCE(quantity,1) * unitPrice * COALESCE(discountValue,0) / 100)
                         WHEN discountType = 'fixed' THEN COALESCE(discountValue,0)
                         ELSE 0 END))`);

// treatment_plans rollups, over non-cancelled items only.
await conn.query('UPDATE treatment_plans SET totalAmount = 0, discountTotal = 0, netAmount = 0');
await conn.query(`
  UPDATE treatment_plans tp
    JOIN (SELECT treatmentPlanId,
                 SUM(COALESCE(quantity,1) * unitPrice) AS gross,
                 SUM(netAmount)                        AS net
            FROM treatment_plan_items
           WHERE status <> 'cancelled'
           GROUP BY treatmentPlanId) x ON x.treatmentPlanId = tp.id
     SET tp.totalAmount   = x.gross,
         tp.discountTotal = x.gross - x.net,
         tp.netAmount     = x.net`);

// invoices: totals from the lines, then paidAmount from the payments.
await conn.query('UPDATE invoices SET subtotal = 0, discountTotal = 0, totalAmount = 0');
await conn.query(`
  UPDATE invoices i
    JOIN (SELECT invoiceId,
                 SUM(amount) AS total,
                 SUM(CASE WHEN itemType <> 'discount'
                          THEN COALESCE(quantity,1) * unitPrice ELSE 0 END) AS sub,
                 SUM(CASE WHEN itemType = 'discount'
                          THEN ABS(amount) ELSE COALESCE(discountAmount,0) END) AS disc
            FROM invoice_items GROUP BY invoiceId) x ON x.invoiceId = i.id
     SET i.totalAmount = x.total, i.subtotal = x.sub, i.discountTotal = x.disc`);

await conn.query(`
  UPDATE invoices i
    LEFT JOIN (SELECT invoiceId,
                      SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END) AS paid
                 FROM payments WHERE invoiceId IS NOT NULL GROUP BY invoiceId) p
      ON p.invoiceId = i.id
     SET i.paidAmount = COALESCE(p.paid, 0)`);

// Status follows the amounts, except for the two decisions amounts cannot express.
await conn.query(`
  UPDATE invoices
     SET status = CASE
       WHEN status IN ('waived','cancelled','refunded') THEN status
       WHEN paidAmount <= 0                             THEN 'unpaid'
       WHEN paidAmount >= totalAmount                   THEN 'paid'
       ELSE 'partial' END`);

// patients.hasAlerts mirrors an active alert condition, and nothing else.
await conn.query(`
  UPDATE patients p
     SET hasAlerts = (
       SELECT COUNT(*) > 0 FROM patient_conditions c
        WHERE c.patientId = p.id AND c.isAlert = 1 AND c.status = 'active')`);

console.log('  done.');

/* ── Report ───────────────────────────────────────────────────────────── */

const [[totals]] = await conn.query(`
  SELECT (SELECT COUNT(*) FROM patients)                              AS patients,
         (SELECT COUNT(*) FROM appointments)                          AS appointments,
         (SELECT COUNT(*) FROM visits)                                AS visits,
         (SELECT COUNT(*) FROM invoices)                              AS invoices,
         (SELECT COALESCE(SUM(totalAmount),0) FROM invoices)          AS billed,
         (SELECT COALESCE(SUM(CASE WHEN type='refund' THEN -amount ELSE amount END),0)
            FROM payments)                                            AS collected,
         (SELECT COUNT(*) FROM leads)                                 AS leads`);

console.log(`\nSeeded ${rows.total()} rows.`);
console.log(
  `  ${totals.patients} patients · ${totals.appointments} appointments · ` +
  `${totals.visits} visits · ${totals.invoices} invoices · ${totals.leads} leads`
);
console.log(
  `  Rs ${Number(totals.billed).toLocaleString('en-PK')} billed, ` +
  `Rs ${Number(totals.collected).toLocaleString('en-PK')} collected`
);

if (world.credentials.length) {
  console.log('\nStaff logins (all share one password for the demo):');
  const width = Math.max(...world.credentials.map((c) => c.email.length));
  for (const cred of world.credentials) {
    console.log(
      `  ${cred.email.padEnd(width)}  ${cred.password}  ` +
      `${cred.role}${cred.branch ? ` · ${cred.branch}` : ''}`
    );
  }
}

await conn.end();
console.log('\nRun `npm run check:invariants` to confirm the data is consistent.');
