import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import * as relations from './relations';

/**
 * Exported for the rare paths that need raw, streaming access — the full data
 * export pages through tables with pool.query directly. Everything else goes
 * through `db`.
 */
export const pool = mysql.createPool({
  host: process.env.DB_HOST!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASS!,
  database: process.env.DB_NAME!,
  port: Number(process.env.DB_PORT) || 3306,
  ssl: { rejectUnauthorized: false },

  // MySQL DATETIME carries no timezone. Left at the mysql2 default of
  // 'local', a DATETIME is parsed against the *Node process* timezone — UTC on
  // Vercel, Asia/Karachi on a developer's Mac — so the same row becomes two
  // different instants and every appointment slot, reminder window and
  // daily-collection cutoff shifts by five hours between environments.
  //
  // Pinning 'Z' makes the mapping deterministic and process-independent:
  // DATETIME columns hold naive clinic-local wall clock, and every read/write
  // goes through the UTC getters in lib/datetime.ts. Do not remove this, and
  // do not format these values with toLocaleString() in the browser.
  timezone: 'Z',
});

export const db = drizzle(pool, {
  schema: { ...schema, ...relations },
  mode: 'default',
});
