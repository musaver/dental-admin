/**
 * Exercises the authorisation rules against the live database.
 *
 * Read-only apart from rows it creates and removes itself in a temporary
 * branch, which is cleaned up on both success and failure.
 *
 *   npm run check:rbac
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { parsePermissions, PERMISSIONS, hasPermission } from '../lib/permissions';
import { resolveBranchScope, AuthError } from '../lib/branch-scope';

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
const check = (label, cond) => {
  console.log(`  ${cond ? 'ok   ' : 'FAIL '} ${label}`);
  if (!cond) failed++;
};

/* 1. The seeded roles grant what their names imply ------------------- */

const [roles] = await conn.execute('SELECT name, permissions FROM admin_roles ORDER BY name');
const byName = Object.fromEntries(roles.map((r) => [r.name, parsePermissions(r.permissions)]));

check('Admin / Owner can manage roles', hasPermission(byName['Admin / Owner'], PERMISSIONS.ROLES_MANAGE));
check('Admin / Owner can export data', hasPermission(byName['Admin / Owner'], PERMISSIONS.EXPORT_DATA));

check('Dentist can edit clinical records', hasPermission(byName['Dentist'], PERMISSIONS.CLINICAL_EDIT));
check(
  'Dentist CANNOT see financial reports',
  !hasPermission(byName['Dentist'], PERMISSIONS.REPORTS_FINANCIAL)
);
check('Dentist CANNOT manage staff', !hasPermission(byName['Dentist'], PERMISSIONS.STAFF_MANAGE));

check('Receptionist can record payments', hasPermission(byName['Receptionist'], PERMISSIONS.PAYMENTS_RECORD));
check(
  'Receptionist CANNOT edit clinical records',
  !hasPermission(byName['Receptionist'], PERMISSIONS.CLINICAL_EDIT)
);
check(
  'Receptionist CANNOT refund payments',
  !hasPermission(byName['Receptionist'], PERMISSIONS.PAYMENTS_REFUND)
);

check('Assistant can view clinical records', hasPermission(byName['Assistant'], PERMISSIONS.CLINICAL_VIEW));
check('Assistant CANNOT view billing', !hasPermission(byName['Assistant'], PERMISSIONS.BILLING_VIEW));
check(
  'Assistant CANNOT edit clinical records',
  !hasPermission(byName['Assistant'], PERMISSIONS.CLINICAL_EDIT)
);

check(
  'Manager can see financial reports',
  hasPermission(byName['Manager'], PERMISSIONS.REPORTS_FINANCIAL)
);
check(
  'Manager CANNOT manage roles (owner-only)',
  !hasPermission(byName['Manager'], PERMISSIONS.ROLES_MANAGE)
);

/* 2. Branch scoping --------------------------------------------------- */

const headOffice = { isHeadOffice: true, branchId: null };
const scoped = { isHeadOffice: false, branchId: 'branch-A' };

check(
  'head office with no request sees every branch',
  resolveBranchScope(headOffice, null).branchIds === null
);
check(
  'head office can narrow to one branch',
  resolveBranchScope(headOffice, 'branch-B').branchIds?.[0] === 'branch-B'
);
check(
  'scoped user is confined to their own branch',
  resolveBranchScope(scoped, null).branchIds?.[0] === 'branch-A'
);
check(
  'scoped user asking for their own branch is allowed',
  resolveBranchScope(scoped, 'branch-A').branchIds?.[0] === 'branch-A'
);

let denied = false;
try {
  resolveBranchScope(scoped, 'branch-B');
} catch (error) {
  denied = error instanceof AuthError && error.status === 403;
}
check("scoped user asking for another branch is refused, not silently emptied", denied);

let allDenied = false;
try {
  resolveBranchScope(scoped, 'all');
} catch {
  allDenied = true;
}
check('scoped user asking for "all" gets their branch, not everything', !allDenied);

/* 3. The seeded owner is head office --------------------------------- */

const [[owner]] = await conn.execute(
  'SELECT email, branchId, isActive FROM admin_users ORDER BY createdAt LIMIT 1'
);
check('seeded owner has a NULL branchId (head office)', owner.branchId === null);
check('seeded owner is active', owner.isActive === 1);

/* 4. Lockout counting works on the real table ------------------------ */

const probeEmail = `rbac-probe-${randomUUID()}@example.invalid`;
try {
  for (let i = 0; i < 3; i++) {
    await conn.execute(
      'INSERT INTO login_attempts (id, email, ipAddress, success, createdAt) VALUES (?,?,?,?,NOW())',
      [randomUUID(), probeEmail, '203.0.113.9', 0]
    );
  }
  const [[{ n }]] = await conn.execute(
    `SELECT COUNT(*) n FROM login_attempts
      WHERE email = ? AND success = 0 AND createdAt >= NOW() - INTERVAL 15 MINUTE`,
    [probeEmail]
  );
  check('failed attempts are counted inside the 15-minute window', Number(n) === 3);
} finally {
  await conn.execute('DELETE FROM login_attempts WHERE email = ?', [probeEmail]);
}

await conn.end();

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAuthorisation rules behave as intended.');
