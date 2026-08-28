import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { patients, recalls } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { clinicNow, addDays } from '@/lib/datetime';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';

/**
 * The recall worklist. Default view is "someone should act": pending and due
 * within the horizon, overdue first. 'overdue' is derived here, never stored.
 */
export const GET = withAuth(PERMISSIONS.RECALLS_MANAGE, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const horizon = Number(url.searchParams.get('withinDays')) || 30;
  const now = clinicNow();

  const filters = [
    eq(recalls.status, 'pending'),
    lte(recalls.dueDate, addDays(now, horizon)),
  ];
  if (branchIds) filters.push(inArray(recalls.branchId, branchIds));

  const rows = await db
    .select({
      id: recalls.id,
      recallType: recalls.recallType,
      dueDate: recalls.dueDate,
      status: recalls.status,
      notes: recalls.notes,
      patientId: recalls.patientId,
      patientMrn: patients.mrn,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      patientPhone: patients.phone,
      patientEmail: patients.email,
    })
    .from(recalls)
    .leftJoin(patients, eq(recalls.patientId, patients.id))
    .where(and(...filters))
    .orderBy(asc(recalls.dueDate))
    .limit(200);

  return NextResponse.json(
    rows.map((row) => ({ ...row, overdue: row.dueDate ? row.dueDate <= now : false }))
  );
});
