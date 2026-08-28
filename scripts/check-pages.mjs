/**
 * Smoke test: every staff page and its data endpoint, as an authenticated
 * owner. Confirms pages render (200, not a redirect to /login) and every list
 * API returns real data — catching runtime errors that a build never sees.
 *
 * Needs the dev server running.
 *
 *   npm run check:pages
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

const email = `pages-check-${Date.now()}@example.invalid`;
const password = `Chk-${randomUUID()}`;
const [[role]] = await conn.query("SELECT id FROM admin_roles WHERE name = 'Admin / Owner'");
const staffId = randomUUID();
await conn.query(
  `INSERT INTO admin_users (id,email,password,name,roleId,staffType,isActive,createdAt,updatedAt)
   VALUES (?,?,?,?,?,'other',1,NOW(),NOW())`,
  [staffId, email, await bcrypt.hash(password, 12), 'Pages Check', role.id]);

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

  console.log('Pages render (no redirect to /login):');
  const pages = [
    '/', '/schedule', '/queue', '/patients', '/patients/new', '/treatment-plans',
    '/recalls', '/billing', '/payments', '/leads', '/communications', '/tasks',
    '/reports/clinical', '/reports/financial', '/admins', '/admins/add', '/roles',
    '/roles/add', '/procedures', '/settings', '/settings/templates', '/audit', '/users',
  ];
  for (const path of pages) {
    const res = await fetch(BASE + path, { headers: { cookie: cookie() }, redirect: 'manual' });
    const html = res.status === 200 ? await res.text() : '';
    // A real page ships its own markup, not just the shell.
    const rendered = res.status === 200 && html.length > 2000;
    check(path, rendered, res.status !== 200 ? `HTTP ${res.status}` : '');
  }

  console.log('\nData endpoints return content:');
  const endpoints = [
    ['/api/dashboard', (b) => typeof b.activePatients === 'number'],
    ['/api/patients', (b) => Array.isArray(b.rows)],
    ['/api/appointments', (b) => Array.isArray(b)],
    ['/api/schedule/resources', (b) => Array.isArray(b.chairs) && Array.isArray(b.dentists)],
    ['/api/procedures', (b) => Array.isArray(b) && b.length === 31],
    ['/api/treatment-plans', (b) => Array.isArray(b.rows)],
    ['/api/invoices', (b) => Array.isArray(b.rows)],
    ['/api/payments', (b) => Array.isArray(b)],
    ['/api/leads', (b) => Array.isArray(b.rows)],
    ['/api/recalls', (b) => Array.isArray(b)],
    ['/api/communications', (b) => Array.isArray(b)],
    ['/api/tasks', (b) => Array.isArray(b)],
    ['/api/roles', (b) => Array.isArray(b) && b.length === 5],
    ['/api/admins', (b) => Array.isArray(b)],
    ['/api/settings', (b) => b.settings && Array.isArray(b.branches)],
    ['/api/settings/templates', (b) => Array.isArray(b) && b.length > 5],
    ['/api/audit', (b) => Array.isArray(b.rows)],
    ['/api/reports/financial', (b) => Array.isArray(b.byDay)],
    ['/api/reports/clinical', (b) => b.appointments && b.recalls],
  ];
  for (const [path, valid] of endpoints) {
    const res = await fetch(BASE + path, { headers: { cookie: cookie() } });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    check(path, res.status === 200 && body !== null && valid(body),
      res.status !== 200 ? `HTTP ${res.status}` : '');
  }
} finally {
  await conn.query('DELETE FROM audit_logs WHERE actorId = ?', [staffId]);
  await conn.query('DELETE FROM login_attempts WHERE email = ?', [email]);
  await conn.query('DELETE FROM admin_users WHERE id = ?', [staffId]);
  await conn.end();
  console.log('\nCleaned up the temporary account.');
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nEvery page and endpoint responds correctly.');
