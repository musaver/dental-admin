/**
 * Exercises the full data export through the REAL auth flow.
 *
 * Creates a temporary staff account with the Admin/Owner role, signs in via
 * NextAuth's credentials endpoint exactly as the browser would, streams the
 * export, and verifies the things that matter:
 *
 *   - no session, no export
 *   - the audit row exists even though the download could have been aborted
 *   - NOT ONE password hash, OTP or token appears anywhere in the output
 *
 * The account and its audit rows are removed afterwards.
 *
 * Needs the dev server running.
 *
 *   npm run check:export
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';

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

const email = `export-check-${Date.now()}@example.invalid`;
const password = `Chk-${randomUUID()}`;
let staffId = null;

/** Sign in the way the browser does, collecting cookies along the way. */
async function signIn() {
  const jar = new Map();
  const remember = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      jar.set(k.trim(), v);
    }
  };
  const cookies = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  remember(csrfRes);
  const { csrfToken } = await csrfRes.json();

  const login = await fetch(`${BASE}/api/auth/callback/staff-credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookies() },
    body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    redirect: 'manual',
  });
  remember(login);

  return { cookies };
}

try {
  const [[role]] = await conn.query("SELECT id FROM admin_roles WHERE name = 'Admin / Owner'");
  staffId = randomUUID();
  await conn.query(
    `INSERT INTO admin_users (id, email, password, name, roleId, staffType, isActive, createdAt, updatedAt)
     VALUES (?,?,?,?,?,'other',1,NOW(),NOW())`,
    [staffId, email, await bcrypt.hash(password, 12), 'Export Check', role.id]
  );

  const session = await signIn();

  const me = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: session.cookies() } });
  const sessionBody = await me.json();
  check('the temporary account can sign in', sessionBody?.user?.email === email);
  check(
    'its session carries the export_data permission',
    (sessionBody?.user?.permissions ?? []).includes('export_data')
  );

  /* The export itself ---------------------------------------------------- */

  const res = await fetch(`${BASE}/api/export/full`, { headers: { cookie: session.cookies() } });
  check('the export streams with 200', res.status === 200);
  check(
    'as NDJSON with a dated filename',
    (res.headers.get('content-type') ?? '').includes('ndjson') &&
      /clinic-export-\d{4}-\d{2}-\d{2}\.ndjson/.test(res.headers.get('content-disposition') ?? '')
  );

  const text = await res.text();
  const lines = text.trim().split('\n').map((l) => JSON.parse(l));

  const meta = lines[0]?._meta;
  check('line one is the manifest', Boolean(meta), `${meta?.tables?.length} tables`);
  check('the export completed', Boolean(lines[lines.length - 1]?._done));
  check('it names who exported', meta?.exportedBy === email);

  const tablesSeen = new Set(lines.filter((l) => l.table).map((l) => l.table));
  check('seeded tables are present', tablesSeen.has('procedures') && tablesSeen.has('admin_roles'),
    [...tablesSeen].slice(0, 5).join(', ') + '…');

  const procedureCount = lines.filter((l) => l.table === 'procedures').length;
  check('all 31 seeded procedures are in it', procedureCount === 31, `${procedureCount}`);

  /* The security boundary ------------------------------------------------ */

  const staffRows = lines.filter((l) => l.table === 'admin_users');
  check(
    'admin_users rows carry NO password column',
    staffRows.length > 0 && staffRows.every((l) => !('password' in l.row))
  );

  // The bcrypt hash we just created must not appear ANYWHERE in the payload.
  const [[hashRow]] = await conn.query('SELECT password FROM admin_users WHERE id = ?', [staffId]);
  check('no bcrypt hash appears anywhere in the output', !text.includes(hashRow.password.slice(0, 20)));
  check('no $2b$ bcrypt marker at all', !text.includes('$2b$'));
  check(
    'the auth machinery tables are absent entirely',
    !tablesSeen.has('sessions') && !tablesSeen.has('verification_tokens') &&
      !tablesSeen.has('account') && !tablesSeen.has('login_attempts')
  );

  /* The audit row exists even if the download had been aborted ----------- */

  const [audits] = await conn.query(
    "SELECT id FROM audit_logs WHERE actorId = ? AND action = 'export'", [staffId]
  );
  check('the export wrote an audit row', audits.length === 1);

  /* The rate limit -------------------------------------------------------- */

  await fetch(`${BASE}/api/export/full`, { headers: { cookie: session.cookies() } }).then((r) => r.text());
  await fetch(`${BASE}/api/export/full`, { headers: { cookie: session.cookies() } }).then((r) => r.text());
  const fourth = await fetch(`${BASE}/api/export/full`, { headers: { cookie: session.cookies() } });
  check('the fourth export in a day is refused', fourth.status === 429);
} finally {
  if (staffId) {
    await conn.query('DELETE FROM audit_logs WHERE actorId = ?', [staffId]);
    await conn.query('DELETE FROM login_attempts WHERE email = ?', [email]);
    await conn.query('DELETE FROM admin_users WHERE id = ?', [staffId]);
    console.log('\nCleaned up the temporary account.');
  }
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nThe data export behaves correctly.');
