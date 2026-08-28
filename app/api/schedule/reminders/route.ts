import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { sendAppointmentReminders } from '@/lib/reminders';
import { addDays, clinicNow, endOfDay, fromDateKey, startOfDay } from '@/lib/datetime';
import { z } from 'zod';

const schema = z.object({
  /** 'YYYY-MM-DD'; defaults to tomorrow. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * The manual "send reminders" button on the diary.
 *
 * Exists alongside the cron so the front desk stays in control: the daily job
 * can be down, mistimed, or simply not trusted yet, and this always works.
 * Idempotency comes from reminderEmailSentAt, so pressing it after the cron
 * ran sends nothing twice.
 */
export const POST = withAuth(PERMISSIONS.APPOINTMENTS_EDIT, async (req) => {
  const parsed = schema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
  }

  const target = parsed.data.date
    ? fromDateKey(parsed.data.date)
    : addDays(clinicNow(), 1);

  const result = await sendAppointmentReminders({
    from: startOfDay(target),
    to: endOfDay(target),
  });

  return NextResponse.json(result);
});
