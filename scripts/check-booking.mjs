/**
 * Booking someone who has never been seen before, through the real HTTP flow.
 *
 * POST /api/appointments takes either an existing patientId or the details of
 * a new patient, and creates both in ONE transaction. The assertions that
 * matter are the negative ones: a refused booking must leave NO patient behind,
 * or the front desk registers the same person again on the retry.
 *
 * Needs the dev server running.
 *
 *   npm run check:booking
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

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

const made = { staff: [], patients: [], appointments: [] };

/** Track whatever the API created so teardown can find it again. */
const remember = (body) => {
  if (body?.patient?.id) made.patients.push(body.patient.id);
  if (body?.appointment?.id) made.appointments.push(body.appointment.id);
};

const countPatientsByPhone = async (phone) => {
  const [[row]] = await conn.query(
    "SELECT COUNT(*) n FROM patients WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 9) = ?",
    [phone.replace(/\D/g, '').slice(-9)]
  );
  return row.n;
};

/** A signed-in staff session: its own cookie jar and a post() bound to it. */
async function signIn({ branchId }) {
  const [[role]] = await conn.query("SELECT id FROM admin_roles WHERE name = 'Admin / Owner'");
  const id = randomUUID();
  const email = `booking-${randomUUID().slice(0, 8)}@example.invalid`;
  const password = `Chk-${randomUUID()}`;

  await conn.query(
    `INSERT INTO admin_users (id,email,password,name,roleId,branchId,staffType,isActive,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,'dentist',1,NOW(),NOW())`,
    [id, email, await bcrypt.hash(password, 12), 'Booking Check', role.id, branchId]
  );
  made.staff.push({ id, email });

  const store = new Map();
  const keep = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      store.set(k.trim(), v.join('='));
    }
  };
  const cookie = () => [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  keep(csrfRes);
  const { csrfToken } = await csrfRes.json();
  keep(
    await fetch(`${BASE}/api/auth/callback/staff-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookie() },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
      redirect: 'manual',
    })
  );

  return {
    id,
    async post(path, body) {
      const res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie() },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    async get(path) {
      const res = await fetch(BASE + path, { headers: { cookie: cookie() } });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
  };
}

try {
  const [[branch]] = await conn.query('SELECT id FROM branches LIMIT 1');
  const [[chair]] = await conn.query('SELECT id FROM chairs WHERE branchId = ? LIMIT 1', [branch.id]);

  const desk = await signIn({ branchId: branch.id });
  // branchId NULL is head office; it must name a branch to register into.
  const headOffice = await signIn({ branchId: null });

  // Well clear of the seeded diary, and inside the 09:00–21:00 clinic day.
  const slot = (dayOffset, hour) => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + dayOffset);
    start.setUTCHours(hour, 0, 0, 0);
    return { startAt: start.toISOString(), endAt: new Date(start.getTime() + 1800_000).toISOString() };
  };

  const phone = `0300 7${String(Date.now()).slice(-6)}`;
  const booking = (extra) => ({
    dentistId: desk.id,
    chairId: chair?.id ?? null,
    type: 'consultation',
    ...extra,
  });

  /* 1. The whole point: book someone not on the register ---------------- */
  const first = await desk.post(
    '/api/appointments',
    booking({
      ...slot(400, 10),
      newPatient: { firstName: 'Walkin', lastName: 'Stranger', phone, email: 'stranger@example.invalid' },
    })
  );
  remember(first.body);
  check(
    'an unregistered patient can be booked in one request',
    first.status === 201 && /^[A-Z]+-\d{6}$/.test(first.body?.patient?.mrn ?? ''),
    first.body?.patient?.mrn ?? `status ${first.status}`
  );

  const newPatientId = first.body?.patient?.id;
  const [[stored]] = await conn.query(
    'SELECT patientId, branchId FROM appointments WHERE id = ?',
    [first.body?.appointment?.id ?? '']
  );
  check('the appointment points at the patient it registered', stored?.patientId === newPatientId);
  check('and takes its branch from that patient', stored?.branchId === branch.id);

  const resolved = await desk.get(`/api/patients?id=${newPatientId}`);
  check(
    'the new patient resolves by id for the picker',
    resolved.status === 200 && resolved.body?.rows?.[0]?.id === newPatientId
  );

  /* 2. The same person again is flagged, not silently duplicated -------- */
  const dupBefore = await countPatientsByPhone(phone);
  const dup = await desk.post(
    '/api/appointments',
    booking({ ...slot(400, 12), newPatient: { firstName: 'Walkin', lastName: 'Stranger', phone } })
  );
  check(
    'the same number is flagged as a possible duplicate',
    dup.status === 409 && dup.body?.code === 'POSSIBLE_DUPLICATE' && dup.body?.duplicates?.length > 0
  );
  check('and nothing was written while it was flagged', (await countPatientsByPhone(phone)) === dupBefore);

  const overridden = await desk.post(
    '/api/appointments',
    booking({
      ...slot(400, 12),
      newPatient: { firstName: 'Walkin', lastName: 'Stranger', phone, allowDuplicate: true },
    })
  );
  remember(overridden.body);
  check('a reviewed duplicate registers anyway', overridden.status === 201);

  /* 3. A refused booking must not leave a patient behind ---------------- */
  // This is the assertion that the two writes really are one transaction.
  const clashPhone = `0300 8${String(Date.now()).slice(-6)}`;
  const clash = await desk.post(
    '/api/appointments',
    booking({ ...slot(400, 10), newPatient: { firstName: 'Rolled', lastName: 'Back', phone: clashPhone } })
  );
  remember(clash.body);
  check(
    'a clashing slot is refused',
    clash.status === 409 && clash.body?.code === 'APPOINTMENT_CONFLICT'
  );
  check(
    'and the refused registration is rolled back with it',
    (await countPatientsByPhone(clashPhone)) === 0
  );

  const retried = await desk.post(
    '/api/appointments',
    booking({
      ...slot(400, 10),
      newPatient: { firstName: 'Rolled', lastName: 'Back', phone: clashPhone },
      allowOverlap: true,
    })
  );
  remember(retried.body);
  check('booking over the clash registers them once', retried.status === 201);
  check('exactly once', (await countPatientsByPhone(clashPhone)) === 1);

  /* 4. One patient, named one way --------------------------------------- */
  const both = await desk.post(
    '/api/appointments',
    booking({
      ...slot(401, 10),
      patientId: newPatientId,
      newPatient: { firstName: 'Either', phone: '0300 1112223' },
    })
  );
  check('naming a patient both ways is refused', both.status === 400);

  const neither = await desk.post('/api/appointments', booking(slot(401, 11)));
  check('naming no patient at all is refused', neither.status === 400);

  /* 5. Head office has to say which branch issues the MRN --------------- */
  const hoPhone = `0300 9${String(Date.now()).slice(-6)}`;
  const unscoped = await headOffice.post(
    '/api/appointments',
    booking({ ...slot(402, 10), newPatient: { firstName: 'Head', lastName: 'Office', phone: hoPhone } })
  );
  check(
    'head office is asked which branch is registering',
    unscoped.status === 400 && Boolean(unscoped.body?.details?.['newPatient.branchId']),
    unscoped.body?.error
  );
  check('and nothing was written while it asked', (await countPatientsByPhone(hoPhone)) === 0);

  const scoped = await headOffice.post(
    '/api/appointments',
    booking({
      ...slot(402, 10),
      dentistId: headOffice.id,
      newPatient: { firstName: 'Head', lastName: 'Office', phone: hoPhone, branchId: branch.id },
    })
  );
  remember(scoped.body);
  check('and books once it has been told', scoped.status === 201, scoped.body?.patient?.mrn);

  const branches = await desk.get('/api/branches');
  check(
    'a branch-scoped user is offered only their own branch',
    branches.status === 200 && branches.body?.length === 1 && branches.body[0].id === branch.id
  );
} finally {
  if (made.appointments.length) {
    await conn.query(
      `DELETE FROM appointments WHERE id IN (${made.appointments.map(() => '?').join(',')})`,
      made.appointments
    );
  }
  if (made.patients.length) {
    const ids = made.patients;
    await conn.query(`DELETE FROM audit_logs WHERE patientId IN (${ids.map(() => '?').join(',')})`, ids);
    await conn.query(`DELETE FROM patients WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  for (const { id, email } of made.staff) {
    await conn.query('DELETE FROM audit_logs WHERE actorId = ?', [id]);
    await conn.query('DELETE FROM login_attempts WHERE email = ?', [email]);
    await conn.query('DELETE FROM admin_users WHERE id = ?', [id]);
  }
  console.log('\nCleaned up the booking test data.');
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nBooking an unregistered patient works, and rolls back cleanly.');
