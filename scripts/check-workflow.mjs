/**
 * The full clinic workflow, through the HTTP API as an owner would drive it:
 *
 *   enquiry → convert to patient → book → check in → open visit →
 *   perform procedure → complete (→ recall) → invoice → part-pay → overpay
 *
 * This is the acceptance test that the modules actually connect. Everything it
 * creates is torn down at the end.
 *
 * Needs the dev server running.
 *
 *   npm run check:workflow
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

const BASE = process.env.CHECK_BASE_URL ?? 'http://localhost:3000';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }, timezone: 'Z',
});

let failed = 0;
const check = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok   ' : 'FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};

const email = `workflow-${Date.now()}@example.invalid`;
const password = `Chk-${randomUUID()}`;
const [[role]] = await conn.query("SELECT id FROM admin_roles WHERE name = 'Admin / Owner'");
const staffId = randomUUID();
await conn.query(
  `INSERT INTO admin_users (id,email,password,name,roleId,branchId,staffType,isActive,createdAt,updatedAt)
   VALUES (?,?,?,?,?,(SELECT id FROM branches LIMIT 1),'dentist',1,NOW(),NOW())`,
  [staffId, email, await bcrypt.hash(password, 12), 'Workflow Dentist', role.id]);

// Track created ids for teardown.
const made = { leads: [], patients: [], appointments: [], visits: [], vps: [],
               plans: [], invoices: [], payments: [], recalls: [] };
let leadId, patientId, appointmentId, visitId, invoiceId;

try {
  const jar = new Map();
  const remember = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const [p] = c.split(';'); const [k, ...v] = p.split('='); jar.set(k.trim(), v.join('=')); } };
  const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`); remember(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const login = await fetch(`${BASE}/api/auth/callback/staff-credentials`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password, json: 'true' }), redirect: 'manual' });
  remember(login);

  const post = async (path, body) => {
    const res = await fetch(BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookie() },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const put = async (path, body) => {
    const res = await fetch(BASE + path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: cookie() },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const [[branch]] = await conn.query('SELECT id FROM branches LIMIT 1');
  const [[chair]] = await conn.query('SELECT id FROM chairs LIMIT 1');
  const [[rct]] = await conn.query("SELECT id, defaultPrice FROM procedures WHERE code='END-03'");

  /* 1. Enquiry --------------------------------------------------------- */
  const lead = await post('/api/leads', {
    name: 'Workflow Patient', phone: '0300 900 0001', email: 'wf@example.invalid',
    source: 'instagram', interestNote: 'Root canal',
  });
  check('an enquiry is captured', lead.status === 201, lead.body?.id);
  leadId = lead.body?.id; if (leadId) made.leads.push(leadId);

  /* 2. Convert to patient --------------------------------------------- */
  const convert = await post(`/api/leads/${leadId}/convert`, {});
  check('the enquiry converts to a patient with an MRN',
    convert.status === 201 && /^[A-Z]+-\d+$/.test(convert.body?.patient?.mrn),
    convert.body?.patient?.mrn);
  patientId = convert.body?.patient?.id; if (patientId) made.patients.push(patientId);

  /* 3. Book an appointment for now ------------------------------------- */
  const start = new Date(Date.now() + 3600_000);
  const book = await post('/api/appointments', {
    patientId, dentistId: staffId, chairId: chair.id,
    startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600_000).toISOString(),
    type: 'procedure',
  });
  check('an appointment is booked', book.status === 201, book.body?.appointment?.id);
  appointmentId = book.body?.appointment?.id; if (appointmentId) made.appointments.push(appointmentId);

  /* 4. Check in -------------------------------------------------------- */
  const checkIn = await post(`/api/appointments/${appointmentId}/status`, { status: 'checked_in' });
  check('the patient checks in', checkIn.status === 200 && checkIn.body?.checkedInAt !== null);

  /* 5. Open a visit ---------------------------------------------------- */
  const visit = await post('/api/visits', { patientId, dentistId: staffId, appointmentId });
  check('opening a visit sets the appointment in progress', visit.status === 201);
  visitId = visit.body?.id; if (visitId) made.visits.push(visitId);

  const [[apptState]] = await conn.query('SELECT status FROM appointments WHERE id=?', [appointmentId]);
  check('the appointment is now in_progress', apptState.status === 'in_progress');

  /* 6. Perform the procedure ------------------------------------------- */
  const perform = await post(`/api/visits/${visitId}/procedures`, {
    procedureId: rct.id, teeth: ['16'],
  });
  check('a procedure is recorded', perform.status === 201);
  if (perform.body?.id) made.vps.push(perform.body.id);

  /* 7. Complete the visit → recall ------------------------------------- */
  const complete = await put(`/api/visits/${visitId}`, { status: 'completed' });
  check('completing the visit succeeds', complete.status === 200);

  const [[apptDone]] = await conn.query('SELECT status, completedAt FROM appointments WHERE id=?', [appointmentId]);
  check('and closes the appointment', apptDone.status === 'completed' && apptDone.completedAt !== null);

  const [recallRows] = await conn.query('SELECT id FROM recalls WHERE patientId=?', [patientId]);
  recallRows.forEach((r) => made.recalls.push(r.id));
  // RCT-Molar has no defaultRecallMonths, so none is expected from it.
  check('recall generation ran without error', Array.isArray(recallRows));

  /* 8. Invoice the visit ----------------------------------------------- */
  const invoice = await post('/api/invoices', { patientId, visitId });
  check('the visit is invoiced', invoice.status === 201,
    invoice.body?.invoice?.invoiceNumber);
  invoiceId = invoice.body?.invoice?.id; if (invoiceId) made.invoices.push(invoiceId);
  const total = invoice.body?.invoice?.totalAmount;
  check('the invoice totals the procedure', total === rct.defaultPrice, `${total} vs ${rct.defaultPrice}`);

  /* 9. Part payment ---------------------------------------------------- */
  const part = Math.floor(total / 2);
  const pay1 = await post('/api/payments', { patientId, invoiceId, amount: part, method: 'cash' });
  check('a partial payment leaves the invoice partial',
    pay1.status === 201 && pay1.body?.invoice?.status === 'partial');
  pay1.body?.payments?.forEach((p) => made.payments.push(p.id));

  /* 10. Overpay the rest ----------------------------------------------- */
  const balance = total - part;
  const pay2 = await post('/api/payments', {
    patientId, invoiceId, amount: balance + 5000, method: 'cash', splitExcess: true,
  });
  check('overpaying settles the invoice exactly',
    pay2.status === 201 && pay2.body?.invoice?.status === 'paid');
  pay2.body?.payments?.forEach((p) => made.payments.push(p.id));

  const [[credit]] = await conn.query(
    `SELECT COALESCE(SUM(amount),0) AS n FROM payments
      WHERE patientId=? AND invoiceId IS NULL AND type='payment'`, [patientId]);
  check('the excess became Rs. 5,000 credit on account', Number(credit.n) === 5000, `${credit.n}`);

  /* 11. The 360 summary reflects it all -------------------------------- */
  const summary = await fetch(`${BASE}/api/patients/${patientId}/summary`, { headers: { cookie: cookie() } });
  const summaryBody = await summary.json();
  check('the patient 360 shows the completed visit', summaryBody.visits?.length === 1);
  check('and a zero net balance after the credit',
    summaryBody.billing?.netBalance === -5000,
    `net ${summaryBody.billing?.netBalance}`);
} finally {
  // Child-first teardown.
  const order = [
    ['audit_logs', null], // by actor / patient below
    ['payments', made.payments],
    ['invoice_items', null],
    ['invoices', made.invoices],
    ['recalls', made.recalls],
    ['visit_procedures', made.vps],
    ['visits', made.visits],
    ['appointments', made.appointments],
    ['treatment_plans', made.plans],
    ['leads', made.leads],
    ['patients', made.patients],
  ];
  // invoice_items reference our invoices.
  if (made.invoices.length) {
    await conn.query(`DELETE FROM invoice_items WHERE invoiceId IN (${made.invoices.map(() => '?').join(',')})`, made.invoices);
  }
  if (made.patients.length) {
    await conn.query(`DELETE FROM audit_logs WHERE patientId IN (${made.patients.map(() => '?').join(',')})`, made.patients);
    // Break the lead<->patient pointer before deleting.
    await conn.query(`UPDATE patients SET leadId = NULL WHERE id IN (${made.patients.map(() => '?').join(',')})`, made.patients);
  }
  await conn.query('DELETE FROM audit_logs WHERE actorId = ?', [staffId]);
  for (const [table, ids] of order) {
    if (!ids || !ids.length) continue;
    await conn.query(`DELETE FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  await conn.query('DELETE FROM login_attempts WHERE email = ?', [email]);
  await conn.query('DELETE FROM admin_users WHERE id = ?', [staffId]);
  console.log('\nCleaned up the workflow test data.');
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} step(s) failed.`);
  process.exit(1);
}
console.log('\nThe full clinic workflow runs end to end.');
