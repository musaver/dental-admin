import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import * as relations from './relations';

/**
 * The pool is cached on globalThis because Next.js re-evaluates this module on
 * every hot reload in development. Without the cache each reload built a new
 * pool and abandoned the old one's open sockets, so a managed database with a
 * couple of dozen connections started refusing new ones — the whole app then
 * fails with ER_CON_COUNT_ERROR, and the first casualty is the patient 360,
 * which is the most query-heavy route in the product.
 */
const globalForDb = globalThis as unknown as { __dentalPool?: mysql.Pool };

/**
 * Exported for the rare paths that need raw, streaming access — the full data
 * export pages through tables with pool.query directly. Everything else goes
 * through `db`.
 */
export const pool =
  globalForDb.__dentalPool ??
  mysql.createPool({
    host: process.env.DB_HOST!,
    user: process.env.DB_USER!,
    password: process.env.DB_PASS!,
    database: process.env.DB_NAME!,
    port: Number(process.env.DB_PORT) || 3306,
    ssl: { rejectUnauthorized: false },

    // A managed MySQL instance allows far fewer connections than a self-hosted
    // one — roughly two dozen on a small DigitalOcean plan, shared with every
    // other client including the maintenance scripts. Ten per process (the
    // mysql2 default) exhausts that as soon as a second process appears, so
    // this is deliberately modest and overridable per environment.
    connectionLimit: Number(process.env.DB_POOL_LIMIT) || 5,
    maxIdle: Number(process.env.DB_POOL_LIMIT) || 5,
    idleTimeout: 30_000,
    waitForConnections: true,
    queueLimit: 0,

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

// Only hold the reference in development. In production the module is
// evaluated once per instance and caching it would outlive nothing useful.
if (process.env.NODE_ENV !== 'production') globalForDb.__dentalPool = pool;

export const db = drizzle(pool, {
  schema: { ...schema, ...relations },
  mode: 'default',
});
