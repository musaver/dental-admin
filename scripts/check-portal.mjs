/**
 * Exercises the patient portal end to end through the REAL HTTP flow:
 * OTP request → sign-in → invitation → activation → reading records →
 * accepting a plan — and, most importantly, the row-level boundary.
 *
 * Needs the dev server running with EMAIL_DRY_RUN=1 (the OTP is read from the
 * database, as no mail is actually sent).
 *
 *   npm run check:portal
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID, createHmac } from 'node:crypto';

const BASE = process.env.CHECK_BASE_URL ?? 'http://localhost:3000';

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

const made = { users: [], patients: [], plans: [], appointments: [], logins: [] };

function jar() {
  const store = new Map();
  return {
    remember(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const [k, ...v] = pair.split('=');
        store.set(k.trim(), v.join('='));
      }
    },
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

/** The same HMAC construction as lib/portal-invite.ts. */
function inviteToken(patientId, email) {
  const payload = { patientId, email: email.toLowerCase(), exp: Date.now() + 86_400_000 };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', process.env.NEXTAUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

async function portalSignIn(email) {
  // Request the code…
  const request = await fetch(`${BASE}/api/portal/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const requestBody = await request.json();

  // …read it from the database (dry-run email), and verify it.
  const [[row]] = await conn.query('SELECT otp FROM user WHERE email = ?', [email]);
  const otp = row?.otp;

  const cookies = jar();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  cookies.remember(csrfRes);
  const { csrfToken } = await csrfRes.json();

  const login = await fetch(`${BASE}/api/auth/callback/patient-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookies.header() },
    body: new URLSearchParams({ csrfToken, email, otp: otp ?? '000000', json: 'true' }),
    redirect: 'manual',
  });
  cookies.remember(login);

  return { cookies, requestBody, otp };
}

try {
  const [[branch]] = await conn.query('SELECT id FROM branches LIMIT 1');
  const [[dentist]] = await conn.query('SELECT id FROM admin_users LIMIT 1');

  /* Two portal users, two patients — the boundary needs a neighbour ------ */

  const emailA = `portal-a-${Date.now()}@example.invalid`;
  const emailB = `portal-b-${Date.now()}@example.invalid`;
  const [userA, userB, patientA, patientB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  made.users.push(userA, userB);
  made.patients.push(patientA, patientB);
  made.logins.push(emailA, emailB);

  await conn.query(
    `INSERT INTO user (id, email, name, created_at, updated_at)
     VALUES (?,?,?,NOW(),NOW()), (?,?,?,NOW(),NOW())`,
    [userA, emailA, 'Portal A', userB, emailB, 'Portal B']
  );
  await conn.query(
    `INSERT INTO patients (id, mrn, branchId, firstName, phone, email, portalUserId, status, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,NULL,'active',NOW(),NOW()),
            (?,?,?,?,?,?,?, 'active',NOW(),NOW())`,
    [
      patientA, `ZZP-${Date.now() % 1000000}`, branch.id, 'PatientA', '+923000000007', emailA,
      patientB, `ZZO-${Date.now() % 1000000}`, branch.id, 'PatientB', '+923000000008', emailB, userB,
    ]
  );

  // A proposed plan for each patient.
  const [planA, planB] = [randomUUID(), randomUUID()];
  made.plans.push(planA, planB);
  await conn.query(
    `INSERT INTO treatment_plans (id, patientId, branchId, dentistId, title, status,
                                  totalAmount, discountTotal, netAmount, proposedAt, createdAt, updatedAt)
     VALUES (?,?,?,?,?,'proposed',22000,0,22000,NOW(),NOW(),NOW()),
            (?,?,?,?,?,'proposed',15000,0,15000,NOW(),NOW(),NOW())`,
    [planA, patientA, branch.id, dentist.id, 'Plan for A',
     planB, patientB, branch.id, dentist.id, 'Plan for B']
  );

  /* OTP flow ------------------------------------------------------------- */

  const ghost = await fetch(`${BASE}/api/portal/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `nobody-${Date.now()}@example.invalid` }),
  });
  const ghostBody = await ghost.json();

  const sessionA = await portalSignIn(emailA);
  check(
    'the OTP request reveals nothing about who has an account',
    ghostBody.message === sessionA.requestBody.message
  );
  check('a six-digit code was issued', /^\d{6}$/.test(sessionA.otp ?? ''));

  const meBefore = await fetch(`${BASE}/api/portal/me`, {
    headers: { cookie: sessionA.cookies.header() },
  });
  const meBeforeBody = await meBefore.json();
  check('the patient can sign in', meBefore.status === 200, meBeforeBody?.email ?? '');
  check('an unlinked account sees no records', meBeforeBody.patients?.length === 0);

  const [[otpCleared]] = await conn.query('SELECT otp FROM user WHERE email = ?', [emailA]);
  check('the code is single-use — cleared on success', otpCleared.otp === null);

  /* Audience separation --------------------------------------------------- */

  const staffApi = await fetch(`${BASE}/api/patients`, {
    headers: { cookie: sessionA.cookies.header() },
  });
  check('a patient session cannot reach staff APIs', staffApi.status === 403, `${staffApi.status}`);

  /* Activation ------------------------------------------------------------ */

  const activate = await fetch(`${BASE}/api/portal/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: sessionA.cookies.header() },
    body: JSON.stringify({ token: inviteToken(patientA, emailA) }),
  });
  const activateBody = await activate.json();
  check('the invitation links the record', activate.status === 200 && activateBody.linked === true);

  const wrongEmail = await fetch(`${BASE}/api/portal/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: sessionA.cookies.header() },
    body: JSON.stringify({ token: inviteToken(patientB, emailB) }),
  });
  check(
    "an invitation for someone else's email is refused",
    wrongEmail.status === 403,
    (await wrongEmail.json()).code
  );

  const tampered = await fetch(`${BASE}/api/portal/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: sessionA.cookies.header() },
    body: JSON.stringify({ token: inviteToken(patientA, emailA).slice(0, -4) + 'AAAA' }),
  });
  check('a tampered token is refused', tampered.status === 400);

  /* Row-level reads -------------------------------------------------------- */

  const plans = await fetch(`${BASE}/api/portal/treatment-plans`, {
    headers: { cookie: sessionA.cookies.header() },
  });
  const plansBody = await plans.json();
  check('the patient sees exactly their own plan', plansBody.length === 1 && plansBody[0].id === planA,
    plansBody.map((p) => p.title).join(', '));

  /* THE test: acting on a neighbour's row ---------------------------------- */

  const foreign = await fetch(`${BASE}/api/portal/treatment-plans/${planB}/accept`, {
    method: 'POST',
    headers: { cookie: sessionA.cookies.header() },
  });
  check(
    "accepting another patient's plan returns 404 — not 403, which would confirm it exists",
    foreign.status === 404,
    `${foreign.status}`
  );

  const [[planBRow]] = await conn.query('SELECT status FROM treatment_plans WHERE id = ?', [planB]);
  check("and the neighbour's plan is untouched", planBRow.status === 'proposed');

  /* Accepting their own ----------------------------------------------------- */

  const accept = await fetch(`${BASE}/api/portal/treatment-plans/${planA}/accept`, {
    method: 'POST',
    headers: { cookie: sessionA.cookies.header() },
  });
  check('accepting their own plan works', accept.status === 200);

  const [[planARow]] = await conn.query(
    'SELECT status, acceptedNote, acceptedAt FROM treatment_plans WHERE id = ?', [planA]
  );
  check('the plan is accepted with the portal note', planARow.status === 'accepted' &&
    planARow.acceptedNote === 'Accepted via patient portal' && planARow.acceptedAt !== null);

  const again = await fetch(`${BASE}/api/portal/treatment-plans/${planA}/accept`, {
    method: 'POST',
    headers: { cookie: sessionA.cookies.header() },
  });
  check('accepting twice is a clear 409, not a duplicate write', again.status === 409);

  const [audits] = await conn.query(
    "SELECT actorEmail FROM audit_logs WHERE entityId = ? AND action = 'update'", [planA]
  );
  check('the acceptance is in the audit trail under the patient', audits.length >= 1 &&
    audits.some((a) => a.actorEmail === emailA));
} finally {
  if (made.plans.length) {
    await conn.query(
      `DELETE FROM audit_logs WHERE entityId IN (${made.plans.map(() => '?').join(',')})`,
      made.plans
    );
  }
  if (made.patients.length) {
    await conn.query(
      `DELETE FROM audit_logs WHERE patientId IN (${made.patients.map(() => '?').join(',')})`,
      made.patients
    );
    await conn.query(
      `DELETE FROM communication_logs WHERE patientId IN (${made.patients.map(() => '?').join(',')})`,
      made.patients
    );
  }
  for (const [table, ids] of [
    ['treatment_plans', made.plans],
    ['patients', made.patients],
    ['user', made.users],
  ]) {
    if (!ids.length) continue;
    await conn.query(`DELETE FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  if (made.logins.length) {
    await conn.query(
      `DELETE FROM login_attempts WHERE email IN (${made.logins.map(() => '?').join(',')})
        OR email LIKE 'nobody-%@example.invalid'`,
      made.logins
    );
  }
  console.log('\nCleaned up the portal test data.');
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nThe patient portal behaves correctly.');
