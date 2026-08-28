import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loginAttempts, user } from '@/lib/schema';
import { sendHtmlEmail } from '@/lib/email';
import { renderTemplate } from '@/lib/comm-templates';
import { clinicNow } from '@/lib/datetime';
import { and, eq, gte, sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Step one of portal sign-in: email me a code.
 *
 * PUBLIC — allow-listed in middleware, because no session exists yet. That
 * makes it the most abusable endpoint in the app, so:
 *
 *  - The response is IDENTICAL whether or not the address has an account.
 *    This endpoint must not confirm who is a patient here.
 *  - Requests share the login_attempts sliding window, so it cannot be used
 *    to spray codes or spam inboxes.
 *  - The code is 6 digits from crypto.randomInt, valid 10 minutes, single use
 *    (cleared on verification), and overwritten by any newer request.
 */
export const runtime = 'nodejs';

const schema = z.object({ email: z.string().trim().email().max(255) });

const OTP_TTL_MINUTES = 10;
const MAX_REQUESTS_PER_WINDOW = 4;

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();
  const now = clinicNow();

  // The one thing revealed on abuse is "slow down", never "this address exists".
  const since = new Date(now.getTime() - 15 * 60_000);
  const [recent] = await db
    .select({ n: sql<number>`count(*)` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gte(loginAttempts.createdAt, since)));

  if (Number(recent?.n ?? 0) >= MAX_REQUESTS_PER_WINDOW) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes.', code: 'RATE_LIMITED' },
      { status: 429 }
    );
  }

  // Every request is recorded, account or not, so the window sees everything.
  await db.insert(loginAttempts).values({
    id: randomUUID(),
    email,
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) ?? null,
    success: false,
    createdAt: now,
  });

  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (account) {
    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await db
      .update(user)
      .set({
        otp,
        otpExpiry: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
        updatedAt: now,
      })
      .where(eq(user.id, account.id));

    const rendered = await renderTemplate('portal_otp', { otp });
    // Failure is logged but NOT surfaced: a distinguishable error would
    // reveal the account exists.
    await sendHtmlEmail(email, rendered.subject, rendered.html, {
      tags: ['portal_otp'],
    }).catch((error) => console.error('OTP email failed:', error));
  }

  return NextResponse.json({
    message: 'If that address has a portal account, a sign-in code is on its way.',
  });
}
