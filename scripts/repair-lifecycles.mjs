/**
 * Repairs appointment lifecycles damaged before the lifecycle helper existed.
 *
 * Completing a visit used to write the linked appointment's status directly,
 * skipping the timestamp backfill, so the database holds appointments that are
 * `completed` with a null checkedInAt, appointments still sitting at
 * `scheduled` under a completed visit, and recalls stuck at `booked` for ever
 * because RECALL_STATUS.COMPLETED was never written by application code.
 *
 * DRY RUN BY DEFAULT — prints what it would change and changes nothing:
 *
 *   node scripts/repair-lifecycles.mjs
 *   node scripts/repair-lifecycles.mjs --apply
 *
 * Run this BEFORE landing the matching check:invariants detectors, which go
 * red on exactly this damage.
 *
 * Timestamps are backfilled FROM THE VISIT'S OWN, never from NOW(). Stamping
 * the current time would claim every historical appointment was completed
 * today and destroy every throughput and duration report built on the pair.
 *
 * No audit rows, matching repair-orphans.mjs: a derived-timestamp backfill is
 * a data correction, not a clinical act, and this output is its record.
 * updatedAt is left alone for the same reason — the column carries no
 * ON UPDATE clause, so MySQL will not touch it and the repair stays invisible
 * to anything reading "when did a human last change this".
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const APPLY = process.argv.includes('--apply');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  timezone: 'Z',
});

let pending = 0;

const report = (label, rows, sample = (r) => r.id) => {
  if (!rows.length) return false;
  pending += rows.length;
  console.log(`  ${label}: ${rows.length}`);
  for (const r of rows.slice(0, 3)) console.log(`      ${sample(r)}`);
  return true;
};

console.log(APPLY ? 'APPLYING changes.\n' : 'Dry run — nothing will be changed.\n');

/* 1. Appointments left open under a completed visit ---------------------- */

const OPEN_UNDER_COMPLETED_VISIT = `
  FROM appointments a
  JOIN visits v ON v.appointmentId = a.id AND v.status = 'completed'
 WHERE a.status IN ('scheduled','confirmed','checked_in','in_progress')`;

console.log('Appointments still open under a completed visit (→ completed):');
{
  const [rows] = await conn.query(
    `SELECT a.id, a.status, v.id AS visitId ${OPEN_UNDER_COMPLETED_VISIT}`
  );
  const found = report('open appointments', rows, (r) => `${r.id}  (${r.status}, visit ${r.visitId})`);
  if (!found) console.log('  none');

  if (APPLY && found) {
    // Both the status and every timestamp the sequence needs, in one pass —
    // the same "no holes" rule applyStatusChange() enforces in application
    // code. COALESCE keeps a real timestamp wherever one already exists.
    const [result] = await conn.query(
      `UPDATE appointments a
         JOIN visits v ON v.appointmentId = a.id AND v.status = 'completed'
          SET a.status      = 'completed',
              a.completedAt = COALESCE(a.completedAt, v.updatedAt, v.createdAt),
              a.checkedInAt = COALESCE(a.checkedInAt, v.createdAt),
              a.confirmedAt = COALESCE(a.confirmedAt, a.checkedInAt, v.createdAt)
        WHERE a.status IN ('scheduled','confirmed','checked_in','in_progress')`
    );
    console.log(`      completed ${result.affectedRows}`);
  }
}

/* 2. Cancelled or no-show appointments under a completed visit ----------- */

console.log('\nCancelled / no-show appointments under a completed visit (LISTED ONLY):');
{
  // Deliberately not repaired. A cancellation is terminal by design and stays
  // in the reporting; a no-show that nonetheless has a completed visit is a
  // genuine contradiction. Both need a human to decide which side is wrong.
  const [rows] = await conn.query(
    `SELECT a.id, a.status, v.id AS visitId
       FROM appointments a
       JOIN visits v ON v.appointmentId = a.id AND v.status = 'completed'
      WHERE a.status IN ('cancelled','no_show')`
  );
  if (!rows.length) console.log('  none');
  else {
    console.log(`  ${rows.length} for review — not changed:`);
    for (const r of rows.slice(0, 10)) console.log(`      ${r.id}  (${r.status}, visit ${r.visitId})`);
  }
}

/* 3. Completed appointments with holes in their timeline ----------------- */

const HOLES = `
  FROM appointments a
  LEFT JOIN visits v ON v.appointmentId = a.id
 WHERE a.status = 'completed'
   AND (a.completedAt IS NULL OR a.checkedInAt IS NULL OR a.confirmedAt IS NULL)`;

console.log('\nCompleted appointments with a missing timestamp (→ backfill):');
{
  const [rows] = await conn.query(`SELECT a.id, a.startAt ${HOLES}`);
  const found = report('incomplete timelines', rows);
  if (!found) console.log('  none');

  if (APPLY && found) {
    // startAt is the last resort for an appointment with no visit at all: it
    // is the only truthful instant on the row, and it keeps the ordering of
    // every duration report intact.
    const [result] = await conn.query(
      `UPDATE appointments a
         LEFT JOIN visits v ON v.appointmentId = a.id
          SET a.completedAt = COALESCE(a.completedAt, v.updatedAt, v.createdAt, a.startAt),
              a.checkedInAt = COALESCE(a.checkedInAt, v.createdAt, a.startAt),
              a.confirmedAt = COALESCE(a.confirmedAt, a.checkedInAt, v.createdAt, a.startAt)
        WHERE a.status = 'completed'
          AND (a.completedAt IS NULL OR a.checkedInAt IS NULL OR a.confirmedAt IS NULL)`
    );
    console.log(`      backfilled ${result.affectedRows}`);
  }
}

/* 4. Recalls stuck at booked --------------------------------------------- */

console.log('\nRecalls still booked against a completed appointment (→ completed):');
{
  const [rows] = await conn.query(
    `SELECT r.id, r.recallType, r.appointmentId
       FROM recalls r
       JOIN appointments a ON a.id = r.appointmentId AND a.status = 'completed'
      WHERE r.status = 'booked'`
  );
  const found = report('open recalls', rows, (r) => `${r.id}  (${r.recallType})`);
  if (!found) console.log('  none');

  if (APPLY && found) {
    // status only — recalls.appointmentId keeps naming the appointment that
    // satisfied it, and clearing it would break the pointer pair with
    // appointments.recallId that check:invariants asserts.
    const [result] = await conn.query(
      `UPDATE recalls r
         JOIN appointments a ON a.id = r.appointmentId AND a.status = 'completed'
          SET r.status = 'completed'
        WHERE r.status = 'booked'`
    );
    console.log(`      closed ${result.affectedRows}`);
  }
}

await conn.end();

console.log(
  `\n${pending} row(s) to repair.` +
    (APPLY || !pending ? '' : '\nRe-run with --apply to make these changes.')
);
