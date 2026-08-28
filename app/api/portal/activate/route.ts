import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { patients, user } from '@/lib/schema';
import { requirePortalContext } from '@/lib/portal-auth';
import { verifyInviteToken } from '@/lib/portal-invite';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import { toErrorResponse } from '@/lib/rbac';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const schema = z.object({ token: z.string().min(10).max(2000) });

/**
 * The final step of the invitation flow: a signed-in PATIENT presents the
 * invite token, and — only if the token's email matches their session — the
 * clinical record is linked to their account.
 *
 * The email match is the point of the whole design. The invite went to the
 * address on the patient record; the session proves control of an inbox;
 * requiring them to be the SAME inbox is what stops an invite forwarded to
 * the wrong person linking someone else's chart.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requirePortalContext();

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'That link is not valid.' }, { status: 400 });
    }

    const invite = verifyInviteToken(parsed.data.token);
    if (!invite.ok) {
      return NextResponse.json(
        {
          error:
            invite.reason === 'expired'
              ? 'That invitation has expired. Ask the clinic to send a new one.'
              : 'That link is not valid.',
          code: invite.reason.toUpperCase(),
        },
        { status: 400 }
      );
    }

    if (!ctx.email || ctx.email.toLowerCase() !== invite.email) {
      return NextResponse.json(
        {
          error: 'This invitation was sent to a different email address. Sign in with the address the clinic has on file.',
          code: 'EMAIL_MISMATCH',
        },
        { status: 403 }
      );
    }

    const [patient] = await db
      .select()
      .from(patients)
      .where(eq(patients.id, invite.patientId))
      .limit(1);

    if (!patient) {
      return NextResponse.json({ error: 'That link is not valid.' }, { status: 400 });
    }

    // Idempotent: clicking the link twice is fine, hijacking is not.
    if (patient.portalUserId && patient.portalUserId !== ctx.portalUserId) {
      return NextResponse.json(
        { error: 'This record is already linked to another account.', code: 'ALREADY_LINKED' },
        { status: 409 }
      );
    }

    if (!patient.portalUserId) {
      await db
        .update(patients)
        .set({ portalUserId: ctx.portalUserId, updatedAt: clinicNow() })
        .where(eq(patients.id, patient.id));

      await writeAuditLog({
        actor: { userId: ctx.portalUserId, email: ctx.email },
        action: AUDIT_ACTION.UPDATE,
        entityType: AUDIT_ENTITY.PATIENT,
        entityId: patient.id,
        patientId: patient.id,
        branchId: patient.branchId,
        before: { portalUserId: null },
        after: { portalUserId: ctx.portalUserId },
        request: req,
      });
    }

    return NextResponse.json({ linked: true, mrn: patient.mrn });
  } catch (error) {
    return toErrorResponse(error);
  }
}
