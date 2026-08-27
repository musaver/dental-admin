/**
 * One-time migration baseline.
 *
 * The dental schema was introspected from a database that already existed, so
 * drizzle/0000_baseline_dental.sql describes tables that are ALREADY THERE.
 * Running `drizzle-kit migrate` without this script would try to CREATE all 36
 * of them and fail (or, worse, partially apply).
 *
 * This records the baseline in `__drizzle_migrations` as already-applied, so
 * `migrate` skips it and runs only genuinely new migrations from here on.
 *
 * Safe to re-run: it is a no-op once the baseline row exists.
 *
 *   node scripts/baseline-migrations.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(process.cwd(), 'drizzle');
const TABLE = '__drizzle_migrations';

const journal = JSON.parse(
  fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')
);

if (journal.entries.length !== 1) {
  console.error(
    `Refusing to run: expected exactly 1 journal entry (the baseline), found ${journal.entries.length}.\n` +
      `This script is only for the initial baseline. Use "drizzle-kit migrate" for subsequent migrations.`
  );
  process.exit(1);
}

const entry = journal.entries[0];
const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
const sql = fs.readFileSync(sqlPath, 'utf8');

// Must match drizzle-orm/migrator.cjs exactly: sha256 of the raw file content.
const hash = crypto.createHash('sha256').update(sql).digest('hex');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  timezone: 'Z',
});

try {
  // Same DDL drizzle's own migrator uses.
  await conn.execute(`
    create table if not exists \`${TABLE}\` (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);

  const [rows] = await conn.execute(`select id, hash from \`${TABLE}\``);

  if (rows.some((r) => r.hash === hash)) {
    console.log(`Baseline "${entry.tag}" is already recorded. Nothing to do.`);
  } else if (rows.length > 0) {
    console.error(
      `Refusing to run: ${TABLE} already has ${rows.length} row(s) with different hashes.\n` +
        `Inspect it manually before baselining.`
    );
    process.exitCode = 1;
  } else {
    // Sanity check: the tables this baseline "creates" must already exist.
    const [tables] = await conn.execute(
      `select count(*) as n from information_schema.tables
        where table_schema = ? and table_type = 'BASE TABLE'`,
      [process.env.DB_NAME]
    );
    const expected = (sql.match(/CREATE TABLE/gi) || []).length;
    if (Number(tables[0].n) < expected) {
      console.error(
        `Refusing to run: baseline describes ${expected} tables but the database has ` +
          `only ${tables[0].n}. This database does not look like the one the schema was ` +
          `introspected from — apply the migration normally instead of baselining.`
      );
      process.exitCode = 1;
    } else {
      await conn.execute(
        `insert into \`${TABLE}\` (\`hash\`, \`created_at\`) values (?, ?)`,
        [hash, entry.when]
      );
      console.log(`Recorded baseline "${entry.tag}" as applied.`);
      console.log(`  hash: ${hash}`);
      console.log(`  tables in database: ${tables[0].n} (baseline describes ${expected})`);
      console.log(`\n"drizzle-kit migrate" will now skip the baseline and apply only new migrations.`);
    }
  }
} finally {
  await conn.end();
}
