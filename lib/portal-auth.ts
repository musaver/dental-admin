import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { patients } from '@/lib/schema';
import { AuthError, AUTH_FAILURE } from '@/lib/branch-scope';
import { PATIENT_STATUS } from '@/lib/enums';
import { eq, inArray } from 'drizzle-orm';

/**
 * Row-level authorisation for the patient portal.
 *
 * The rules that every portal route lives by:
 *
 *  1. NO portal route ever accepts a patientId from the client. The linked
 *     patients come from the session's portal user, full stop.
 *  2. Every query filters by those ids IN THE WHERE CLAUSE, not after the
 *     fetch.
 *  3. Not-found and not-yours are both 404. A 403 confirms the row exists,
 *     which turns any id-shaped parameter into an enumeration oracle.
 *
 * One portal account may be linked to SEVERAL patients — a parent and their
 * children — because patients.portalUserId is per-patient. Supporting that
 * from the start costs a `inArray` instead of an `eq`; retrofitting it later
 * would touch every portal query.
 */

export interface PortalContext {
  portalUserId: string;
  email: string | null;
  name: string | null;
  /** Every patient this account may see. */
  patientIds: string[];
  patients: { id: string; mrn: string; firstName: string; lastName: string | null }[];
}

export async function requirePortalContext(): Promise<PortalContext> {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user;

  if (!sessionUser?.id) {
    throw new AuthError(AUTH_FAILURE.UNAUTHENTICATED, 401, 'Sign in to continue.');
  }
  if (sessionUser.kind !== 'patient') {
    throw new AuthError(AUTH_FAILURE.WRONG_AUDIENCE, 403, 'This area is for patients.');
  }

  const linked = await db
    .select({
      id: patients.id,
      mrn: patients.mrn,
      firstName: patients.firstName,
      lastName: patients.lastName,
      status: patients.status,
    })
    .from(patients)
    .where(eq(patients.portalUserId, sessionUser.id));

  // An archived or deceased record is not portal-visible.
  const visible = linked.filter((p) => p.status === PATIENT_STATUS.ACTIVE || p.status === PATIENT_STATUS.INACTIVE);

  return {
    portalUserId: sessionUser.id,
    email: sessionUser.email ?? null,
    name: sessionUser.name ?? null,
    patientIds: visible.map((p) => p.id),
    patients: visible.map(({ status: _status, ...rest }) => rest),
  };
}

/** 404 — never 403 — when a row is not theirs. */
export function assertOwned(row: { patientId: string } | null | undefined, ctx: PortalContext): void {
  if (!row || !ctx.patientIds.includes(row.patientId)) {
    throw new AuthError(AUTH_FAILURE.FORBIDDEN, 404, 'Not found.');
  }
}

/** The WHERE-clause filter every portal list query uses. */
export function ownedPatients(ctx: PortalContext) {
  // inArray with an empty list is invalid SQL; an account linked to no
  // patients simply sees nothing.
  return ctx.patientIds.length ? inArray(patients.id, ctx.patientIds) : undefined;
}
