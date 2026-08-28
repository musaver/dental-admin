import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadPatient } from '@/lib/loaders';
import { createInviteToken } from '@/lib/portal-invite';
import { sendTemplatedEmail } from '@/lib/communications';
import { patientName } from '@/lib/patient-identity';
import { COMM_REFERENCE_TYPE } from '@/lib/enums';

type Params = { params: Promise<{ id: string }> };

/**
 * Staff-initiated portal invitation.
 *
 * Only offered when the patient HAS an email: the portal signs in by email
 * OTP, so a phone-only patient cannot use it yet, and a fake address invented
 * to satisfy the form would send their invitation to a stranger.
 */
export const POST = withAuth(PERMISSIONS.PATIENTS_EDIT, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const patient = await loadPatient(ctx, id);

  if (!patient.email) {
    return NextResponse.json(
      {
        error:
          'This patient has no email address on file, and portal sign-in is by emailed code. Add their email first.',
        code: 'NO_EMAIL',
      },
      { status: 409 }
    );
  }
  if (patient.portalUserId) {
    return NextResponse.json(
      { error: 'This patient already has portal access.', code: 'ALREADY_LINKED' },
      { status: 409 }
    );
  }

  const token = createInviteToken(patient.id, patient.email);
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const activateLink = `${base}/portal/activate?token=${encodeURIComponent(token)}`;

  const outcome = await sendTemplatedEmail({
    to: patient.email,
    templateKey: 'portal_invite',
    vars: {
      patientName: patientName(patient),
      activateLink,
    },
    patientId: patient.id,
    branchId: patient.branchId,
    referenceType: COMM_REFERENCE_TYPE.PORTAL,
    referenceId: patient.id,
    performedBy: ctx.userId,
  });

  return NextResponse.json({ status: outcome.status });
});
