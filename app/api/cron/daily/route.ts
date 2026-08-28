import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loginAttempts } from '@/lib/schema';
import { sendAppointmentReminders, sendRecallReminders } from '@/lib/reminders';
import { clinicNow } from '@/lib/datetime';
import { lt, sql } from 'drizzle-orm';

/**
 * The daily job. Vercel Cron calls it on the schedule in vercel.json; anything
 * else (a GitHub Action, cron-job.org) can call it with the same secret.
 *
 * Middleware allow-lists /api/cron/*, so this handler carries its own
 * authentication: Vercel sends Authorization: Bearer ${CRON_SECRET}
 * automatically when that env var is set, and the x-cron-secret header serves
 * external schedulers.
 *
 * Runs on Node (mysql2 cannot load on Edge) with an extended budget, since a
 * reminder batch is sequential network calls.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const bearer = req.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) return true;
  return req.headers.get('x-cron-secret') === secret;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = clinicNow();

  const [appointmentReminders, recallReminders, purged] = [
    await sendAppointmentReminders(),
    await sendRecallReminders(),
    // login_attempts is brute-force telemetry, not a record: unlike
    // audit_logs (never purged), it only needs the sliding window plus a
    // margin, and it grows fastest of anything under attack.
    await db
      .delete(loginAttempts)
      .where(lt(loginAttempts.createdAt, new Date(startedAt.getTime() - 30 * 86_400_000)))
      .then((r) => (r as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0),
  ];

  return NextResponse.json({
    ranAt: startedAt,
    appointmentReminders,
    recallReminders,
    loginAttemptsPurged: purged,
  });
}

export const POST = GET;
