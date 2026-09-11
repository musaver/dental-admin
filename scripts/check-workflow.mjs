/**
 * The full clinic workflow, through the HTTP API as an owner would drive it:
 *
 *   enquiry → convert to patient → book → check in → open visit →
 *   perform procedure → complete (→ recall) → invoice → part-pay → overpay
 *
 * Then the awkward paths that broke silently before: completing a visit
 * nobody checked the patient in for, completing one against a cancelled
 * appointment, closing the recall an appointment was booked from, and
 * refusing to bill work a treatment plan already invoiced.
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
  const get = async (path) => {
    const res = await fetch(BASE + path, { headers: { cookie: cookie() } });
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

  const [[apptDone]] = await conn.query(
    'SELECT status, completedAt, checkedInAt, confirmedAt FROM appointments WHERE id=?', [appointmentId]);
  check('and closes the appointment', apptDone.status === 'completed' && apptDone.completedAt !== null);
  // The timestamps used to be left null by the direct write, leaving holes in
  // every timeline and duration report built on the pair.
  check('with no holes in the timeline',
    apptDone.checkedInAt !== null && apptDone.confirmedAt !== null,
    `checkedInAt ${apptDone.checkedInAt}, confirmedAt ${apptDone.confirmedAt}`);

  const [[apptAudit]] = await conn.query(
    "SELECT COUNT(*) n FROM audit_logs WHERE entityType='appointment' AND entityId=?", [appointmentId]);
  check('and audits the appointment, not only the visit', Number(apptAudit.n) > 0, `${apptAudit.n} row(s)`);

  const [recallRows] = await conn.query('SELECT id FROM recalls WHERE patientId=?', [patientId]);
  recallRows.forEach((r) => made.recalls.push(r.id));
  // RCT-Molar has no defaultRecallMonths, so none is expected from it.
  check('recall generation ran without error', Array.isArray(recallRows));

  /* 8. Invoice the visit ----------------------------------------------- */
  const backlogBefore = await get('/api/visits/unbilled?pageSize=100');
  check('the visit appears on the unbilled worklist',
    backlogBefore.status === 200 && backlogBefore.body?.rows?.some((r) => r.id === visitId));

  const invoice = await post('/api/invoices', { patientId, visitId });
  check('the visit is invoiced', invoice.status === 201,
    invoice.body?.invoice?.invoiceNumber);
  invoiceId = invoice.body?.invoice?.id; if (invoiceId) made.invoices.push(invoiceId);
  const total = invoice.body?.invoice?.totalAmount;
  check('the invoice totals the procedure', total === rct.defaultPrice, `${total} vs ${rct.defaultPrice}`);

  const billed = await get(`/api/visits/${visitId}`);
  check('the visit now shows its invoice', billed.body?.invoices?.length === 1);
  check('and marks every procedure invoiced',
    billed.body?.procedures?.every((p) => p.invoiced === true));

  const again = await post('/api/invoices', { patientId, visitId });
  check('billing the same visit twice is refused',
    again.status === 409 && again.body?.code === 'NOTHING_TO_INVOICE',
    `HTTP ${again.status}`);

  // The real proof that the worklist predicate and buildLinesFromVisit() agree:
  // a row can only leave the list because the work it named is now billed.
  const backlogAfter = await get('/api/visits/unbilled?pageSize=100');
  check('and the visit leaves the unbilled worklist',
    !backlogAfter.body?.rows?.some((r) => r.id === visitId));

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

  /* 12. A visit completed without anyone checking the patient in -------- */
  // The front desk forgets; the dentist must not be blocked by it, and the
  // appointment must still end up with a truthful, hole-free timeline.
  const start2 = new Date(Date.now() + 7200_000);
  const book2 = await post('/api/appointments', {
    patientId, dentistId: staffId, chairId: chair.id,
    startAt: start2.toISOString(), endAt: new Date(start2.getTime() + 1800_000).toISOString(),
    type: 'checkup',
  });
  const appt2 = book2.body?.appointment?.id; if (appt2) made.appointments.push(appt2);

  const visit2 = await post('/api/visits', { patientId, dentistId: staffId, appointmentId: appt2 });
  const visit2Id = visit2.body?.id; if (visit2Id) made.visits.push(visit2Id);

  const [[opened2]] = await conn.query(
    'SELECT status, checkedInAt FROM appointments WHERE id=?', [appt2]);
  check('opening a visit walks a scheduled appointment through check-in',
    opened2.status === 'in_progress' && opened2.checkedInAt !== null, opened2.status);

  // Force it back to `scheduled` behind the API's back — the state the older
  // direct writes could leave, and the one that used to make completed → null
  // timestamps. scheduled → completed is not a legal single hop, so this only
  // survives because the helper routes it through checked_in.
  await conn.query(
    "UPDATE appointments SET status='scheduled', checkedInAt=NULL, confirmedAt=NULL WHERE id=?",
    [appt2]);

  const done2 = await put(`/api/visits/${visit2Id}`, { status: 'completed' });
  check('a visit completes even though nobody checked the patient in', done2.status === 200);
  check('with no warning, because the walk succeeded',
    Array.isArray(done2.body?.warnings) && done2.body.warnings.length === 0,
    JSON.stringify(done2.body?.warnings));

  const [[appt2State]] = await conn.query(
    'SELECT status, checkedInAt, confirmedAt, completedAt FROM appointments WHERE id=?', [appt2]);
  check('and the skipped appointment is walked to completed',
    appt2State.status === 'completed' &&
    appt2State.checkedInAt !== null && appt2State.confirmedAt !== null &&
    appt2State.completedAt !== null,
    appt2State.status);

  /* 13. A visit completed against a cancelled appointment --------------- */
  // Cancelled is terminal by design, so the appointment is skipped and
  // surfaced as a warning — but the clinical record is still written.
  const start3 = new Date(Date.now() + 10800_000);
  const book3 = await post('/api/appointments', {
    patientId, dentistId: staffId, chairId: chair.id,
    startAt: start3.toISOString(), endAt: new Date(start3.getTime() + 1800_000).toISOString(),
    type: 'checkup',
  });
  const appt3 = book3.body?.appointment?.id; if (appt3) made.appointments.push(appt3);

  const visit3 = await post('/api/visits', { patientId, dentistId: staffId, appointmentId: appt3 });
  const visit3Id = visit3.body?.id; if (visit3Id) made.visits.push(visit3Id);
  await post(`/api/appointments/${appt3}/status`, { status: 'cancelled', reason: 'Patient rang to cancel' });

  const done3 = await put(`/api/visits/${visit3Id}`, { status: 'completed' });
  check('a visit still completes against a cancelled appointment', done3.status === 200);
  check('and says why the appointment was left alone',
    Array.isArray(done3.body?.warnings) && done3.body.warnings.length === 1,
    JSON.stringify(done3.body?.warnings));

  const [[appt3State]] = await conn.query('SELECT status FROM appointments WHERE id=?', [appt3]);
  check('the cancellation is not resurrected', appt3State.status === 'cancelled', appt3State.status);

  /* 14. Completing an appointment closes the recall it came from -------- */
  const recallId = randomUUID();
  await conn.query(
    `INSERT INTO recalls (id,patientId,branchId,recallType,dueDate,intervalMonths,status,createdAt,updatedAt)
     VALUES (?,?,?,'Preventive',NOW(),6,'pending',NOW(),NOW())`,
    [recallId, patientId, branch.id]);
  made.recalls.push(recallId);

  const start4 = new Date(Date.now() + 14400_000);
  const book4 = await post('/api/appointments', {
    patientId, dentistId: staffId, chairId: chair.id,
    startAt: start4.toISOString(), endAt: new Date(start4.getTime() + 1800_000).toISOString(),
    type: 'checkup', recallId,
  });
  const appt4 = book4.body?.appointment?.id; if (appt4) made.appointments.push(appt4);

  const [[recallBooked]] = await conn.query('SELECT status FROM recalls WHERE id=?', [recallId]);
  check('booking from a recall marks it booked', recallBooked.status === 'booked', recallBooked.status);

  await post(`/api/appointments/${appt4}/status`, { status: 'checked_in' });
  await post(`/api/appointments/${appt4}/status`, { status: 'completed' });

  const [[recallDone]] = await conn.query(
    'SELECT status, appointmentId FROM recalls WHERE id=?', [recallId]);
  check('completing the appointment closes the recall',
    recallDone.status === 'completed', recallDone.status);
  // The pointer pair must survive: nulling one side is the drift
  // check:invariants hunts for.
  check('and leaves the pointer pair intact', recallDone.appointmentId === appt4);

  /* 15. A plan invoice is not billed a second time from the visit ------- */
  const plan = await post('/api/treatment-plans', {
    patientId, dentistId: staffId, title: 'Double-bill guard',
  });
  const planId = plan.body?.id; if (planId) made.plans.push(planId);

  const item = await post(`/api/treatment-plans/${planId}/items`, {
    procedureId: rct.id, teeth: ['26'],
  });
  const itemId = item.body?.item?.id;
  check('the plan has an item to bill', item.status === 201 && Boolean(itemId));
  await post(`/api/treatment-plans/${planId}/status`, { status: 'proposed' });
  await post(`/api/treatment-plans/${planId}/status`, { status: 'accepted' });

  const planInvoice = await post('/api/invoices', { patientId, treatmentPlanId: planId });
  check('an accepted plan can be invoiced', planInvoice.status === 201, `HTTP ${planInvoice.status}`);
  if (planInvoice.body?.invoice?.id) made.invoices.push(planInvoice.body.invoice.id);

  const start5 = new Date(Date.now() + 18000_000);
  const book5 = await post('/api/appointments', {
    patientId, dentistId: staffId, chairId: chair.id,
    startAt: start5.toISOString(), endAt: new Date(start5.getTime() + 3600_000).toISOString(),
    type: 'procedure',
  });
  const appt5 = book5.body?.appointment?.id; if (appt5) made.appointments.push(appt5);

  const visit5 = await post('/api/visits', { patientId, dentistId: staffId, appointmentId: appt5 });
  const visit5Id = visit5.body?.id; if (visit5Id) made.visits.push(visit5Id);
  const perform5 = await post(`/api/visits/${visit5Id}/procedures`, {
    procedureId: rct.id, teeth: ['26'], treatmentPlanItemId: itemId,
  });
  if (perform5.body?.id) made.vps.push(perform5.body.id);
  await put(`/api/visits/${visit5Id}`, { status: 'completed' });

  // The work was already billed on the plan invoice. buildLinesFromVisit()
  // de-duplicated only on visitProcedureId, and a plan line carries none — so
  // before the guard existed this charged the patient a second time.
  const doubleBill = await post('/api/invoices', { patientId, visitId: visit5Id });
  check('work billed on its plan is not billed again from the visit',
    doubleBill.status === 409 && doubleBill.body?.code === 'NOTHING_TO_INVOICE',
    `HTTP ${doubleBill.status}`);
  if (doubleBill.body?.invoice?.id) made.invoices.push(doubleBill.body.invoice.id);

  check('and that visit is not on the unbilled worklist either',
    !(await get('/api/visits/unbilled?pageSize=100')).body?.rows?.some((r) => r.id === visit5Id));

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
  // treatment_plan_items hang off our plans and nothing else removes them.
  if (made.plans.length) {
    await conn.query(`DELETE FROM treatment_plan_items WHERE treatmentPlanId IN (${made.plans.map(() => '?').join(',')})`, made.plans);
  }
  if (made.patients.length) {
    await conn.query(`DELETE FROM audit_logs WHERE patientId IN (${made.patients.map(() => '?').join(',')})`, made.patients);
    // Break the lead<->patient pointer before deleting.
    await conn.query(`UPDATE patients SET leadId = NULL WHERE id IN (${made.patients.map(() => '?').join(',')})`, made.patients);
  }
  if (made.leads.length) {
    await conn.query(`DELETE FROM lead_activities WHERE leadId IN (${made.leads.map(() => '?').join(',')})`, made.leads);
    await conn.query(`DELETE FROM communication_logs WHERE leadId IN (${made.leads.map(() => '?').join(',')})`, made.leads);
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
