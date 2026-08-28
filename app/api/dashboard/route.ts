import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appointments, leads, patients, recalls } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { outstandingSummary, collectionsByDay, appointmentStats } from '@/lib/reports';
import {
  addDays,
  clinicNow,
  endOfDay,
  startOfDay,
} from '@/lib/datetime';
import { OPEN_LEAD_STATUSES, RECALL_STATUS } from '@/lib/enums';
import { and, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';

/**
 * ONE request feeds the whole dashboard.
 *
 * Ten widgets each fetching for themselves means ten round trips from Vercel
 * to a database in another region — a visibly slow landing page. Sections the
 * caller lacks permission for come back null and simply do not render.
 */
export const GET = withAuth(null, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));

  const now = clinicNow();
  const today = startOfDay(now);
  const tomorrow = endOfDay(now);

  const canBilling = hasPermission(ctx.permissions, PERMISSIONS.REPORTS_FINANCIAL);
  const canAppointments = hasPermission(ctx.permissions, PERMISSIONS.APPOINTMENTS_VIEW);
  const canLeads = hasPermission(ctx.permissions, PERMISSIONS.LEADS_VIEW);
  const canRecalls = hasPermission(ctx.permissions, PERMISSIONS.RECALLS_MANAGE);
  const canClinical = hasPermission(ctx.permissions, PERMISSIONS.REPORTS_CLINICAL);

  // Each table's branchId is a distinct column type, so the four filters are
  // spelled out rather than fighting drizzle's generics with a helper.
  const apptBranch = branchIds ? inArray(appointments.branchId, branchIds) : undefined;
  const patientBranch = branchIds ? inArray(patients.branchId, branchIds) : undefined;
  const recallBranch = branchIds ? inArray(recalls.branchId, branchIds) : undefined;
  const leadBranch = branchIds ? inArray(leads.branchId, branchIds) : undefined;

  const [todayAppointments, waiting, patientCount, dueRecalls, dueLeads, money, weekStats] =
    await Promise.all([
      canAppointments
        ? db
            .select({ n: sql<number>`count(*)` })
            .from(appointments)
            .where(
              and(
                gte(appointments.startAt, today),
                lt(appointments.startAt, tomorrow),
                apptBranch
              )
            )
        : Promise.resolve([{ n: 0 }]),
      canAppointments
        ? db
            .select({ n: sql<number>`count(*)` })
            .from(appointments)
            .where(
              and(eq(appointments.status, 'checked_in'), apptBranch)
            )
        : Promise.resolve([{ n: 0 }]),
      db
        .select({ n: sql<number>`count(*)` })
        .from(patients)
        .where(and(eq(patients.status, 'active'), patientBranch)),
      canRecalls
        ? db
            .select({ n: sql<number>`count(*)` })
            .from(recalls)
            .where(
              and(
                eq(recalls.status, RECALL_STATUS.PENDING),
                lte(recalls.dueDate, now),
                recallBranch
              )
            )
        : Promise.resolve([{ n: 0 }]),
      canLeads
        ? db
            .select({ n: sql<number>`count(*)` })
            .from(leads)
            .where(
              and(
                inArray(leads.status, OPEN_LEAD_STATUSES as string[]),
                lte(leads.nextFollowUpAt, now),
                leadBranch
              )
            )
        : Promise.resolve([{ n: 0 }]),
      canBilling
        ? Promise.all([
            outstandingSummary(branchIds),
            collectionsByDay({ from: today, to: tomorrow, branchIds }),
          ])
        : Promise.resolve(null),
      canClinical
        ? appointmentStats({ from: addDays(today, -7), to: tomorrow, branchIds })
        : Promise.resolve(null),
    ]);

  return NextResponse.json({
    today: {
      appointments: canAppointments ? Number(todayAppointments[0]?.n ?? 0) : null,
      waiting: canAppointments ? Number(waiting[0]?.n ?? 0) : null,
      collected: money ? (money[1][0]?.net ?? 0) : null,
    },
    activePatients: Number(patientCount[0]?.n ?? 0),
    recallsDue: canRecalls ? Number(dueRecalls[0]?.n ?? 0) : null,
    leadsDue: canLeads ? Number(dueLeads[0]?.n ?? 0) : null,
    outstanding: money ? money[0] : null,
    week: weekStats,
  });
});
