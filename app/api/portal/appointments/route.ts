import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, appointments, patients } from '@/lib/schema';
import { requirePortalContext } from '@/lib/portal-auth';
import { toErrorResponse } from '@/lib/rbac';
import { desc, eq, inArray } from 'drizzle-orm';

/**
 * The patient's own appointments.
 *
 * Note what is NOT here: no patientId parameter. The linked records come from
 * the session, and the filter is in the WHERE clause. Cancelled internal
 * details (who cancelled, staff notes) are not selected at all — the patient
 * sees their diary, not the clinic's bookkeeping.
 */
export async function GET() {
  try {
    const ctx = await requirePortalContext();
    if (!ctx.patientIds.length) return NextResponse.json([]);

    const rows = await db
      .select({
        id: appointments.id,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        type: appointments.type,
        status: appointments.status,
        dentistName: adminUsers.name,
        patientId: appointments.patientId,
        patientFirstName: patients.firstName,
      })
      .from(appointments)
      .leftJoin(adminUsers, eq(appointments.dentistId, adminUsers.id))
      .leftJoin(patients, eq(appointments.patientId, patients.id))
      .where(inArray(appointments.patientId, ctx.patientIds))
      .orderBy(desc(appointments.startAt))
      .limit(100);

    return NextResponse.json(rows);
  } catch (error) {
    return toErrorResponse(error);
  }
}
