import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  adminUsers,
  appointments,
  invoices,
  patientConditions,
  patientFiles,
  payments,
  procedures,
  recalls,
  toothConditions,
  treatmentPlans,
  visits,
} from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { loadPatient } from '@/lib/loaders';
import { auditView } from '@/lib/audit';
import {
  APPOINTMENT_STATUS,
  AUDIT_ENTITY,
  RECALL_STATUS,
  TOOTH_CONDITION_STATUS,
} from '@/lib/enums';
import { signedAmount } from '@/lib/money';
import { clinicNow } from '@/lib/datetime';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

type Params = { params: Promise<{ id: string }> };

/**
 * Everything the patient 360 needs, in one request.
 *
 * The alternative is eight parallel fetches from the client, each a separate
 * round trip from Vercel to a DigitalOcean database. One aggregate endpoint
 * keeps the chart feeling instant, which matters because this is the screen a
 * dentist opens before every appointment.
 *
 * Sections are gated individually: an assistant with clinical_view but no
 * billing_view gets the chart without the money, rather than a 403 for the
 * whole page.
 */
export const GET = withAuth(
  PERMISSIONS.PATIENTS_VIEW,
  async (req, ctx, { params }: Params) => {
    const { id } = await params;
    const patient = await loadPatient(ctx, id);

    const canClinical = hasPermission(ctx.permissions, PERMISSIONS.CLINICAL_VIEW);
    const canBilling = hasPermission(ctx.permissions, PERMISSIONS.BILLING_VIEW);
    const canPlans = hasPermission(ctx.permissions, PERMISSIONS.TREATMENT_PLANS_VIEW);
    const canFiles = hasPermission(ctx.permissions, PERMISSIONS.FILES_VIEW);
    const canAppointments = hasPermission(ctx.permissions, PERMISSIONS.APPOINTMENTS_VIEW);

    const now = clinicNow();

    const [
      alerts,
      chart,
      recentVisits,
      plans,
      upcoming,
      pastAppointments,
      appointmentStats,
      invoiceTotals,
      paymentRows,
      files,
      dueRecalls,
    ] = await Promise.all([
      // Alert conditions drive the red banner. Derived here rather than read
      // from patients.hasAlerts, which is a denormalised flag for list views.
      canClinical
        ? db
            .select()
            .from(patientConditions)
            .where(
              and(eq(patientConditions.patientId, id), eq(patientConditions.status, 'active'))
            )
            .orderBy(desc(patientConditions.isAlert), desc(patientConditions.createdAt))
        : Promise.resolve([]),

      // The odontogram is event-sourced: current state is the active rows.
      canClinical
        ? db
            .select()
            .from(toothConditions)
            .where(
              and(
                eq(toothConditions.patientId, id),
                eq(toothConditions.status, TOOTH_CONDITION_STATUS.ACTIVE)
              )
            )
        : Promise.resolve([]),

      canClinical
        ? db
            .select({
              id: visits.id,
              visitDate: visits.visitDate,
              status: visits.status,
              chiefComplaint: visits.chiefComplaint,
              dentistId: visits.dentistId,
              dentistName: adminUsers.name,
            })
            .from(visits)
            .leftJoin(adminUsers, eq(visits.dentistId, adminUsers.id))
            .where(eq(visits.patientId, id))
            .orderBy(desc(visits.visitDate))
            .limit(10)
        : Promise.resolve([]),

      canPlans
        ? db
            .select({
              id: treatmentPlans.id,
              title: treatmentPlans.title,
              status: treatmentPlans.status,
              netAmount: treatmentPlans.netAmount,
              proposedAt: treatmentPlans.proposedAt,
              acceptedAt: treatmentPlans.acceptedAt,
            })
            .from(treatmentPlans)
            .where(eq(treatmentPlans.patientId, id))
            .orderBy(desc(treatmentPlans.createdAt))
            .limit(10)
        : Promise.resolve([]),

      canAppointments
        ? db
            .select({
              id: appointments.id,
              startAt: appointments.startAt,
              endAt: appointments.endAt,
              type: appointments.type,
              status: appointments.status,
              dentistId: appointments.dentistId,
              dentistName: adminUsers.name,
            })
            .from(appointments)
            .leftJoin(adminUsers, eq(appointments.dentistId, adminUsers.id))
            .where(and(eq(appointments.patientId, id), gte(appointments.startAt, now)))
            .orderBy(appointments.startAt)
            .limit(5)
        : Promise.resolve([]),

      canAppointments
        ? db
            .select({
              id: appointments.id,
              startAt: appointments.startAt,
              type: appointments.type,
              status: appointments.status,
            })
            .from(appointments)
            .where(and(eq(appointments.patientId, id), lt(appointments.startAt, now)))
            .orderBy(desc(appointments.startAt))
            .limit(5)
        : Promise.resolve([]),

      // No-show has no column of its own, so history is a count by status.
      canAppointments
        ? db
            .select({ status: appointments.status, n: sql<number>`count(*)` })
            .from(appointments)
            .where(eq(appointments.patientId, id))
            .groupBy(appointments.status)
        : Promise.resolve([]),

      canBilling
        ? db
            .select({
              billed: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)`,
              paid: sql<number>`COALESCE(SUM(${invoices.paidAmount}), 0)`,
              openCount: sql<number>`SUM(CASE WHEN ${invoices.status} IN ('unpaid','partial') THEN 1 ELSE 0 END)`,
            })
            .from(invoices)
            .where(eq(invoices.patientId, id))
        : Promise.resolve([]),

      // Balance must consider payments too: payments.invoiceId is nullable,
      // so an unallocated deposit is real money that no invoice knows about.
      canBilling
        ? db
            .select({ type: payments.type, amount: payments.amount, invoiceId: payments.invoiceId })
            .from(payments)
            .where(eq(payments.patientId, id))
        : Promise.resolve([]),

      canFiles
        ? db
            .select({
              id: patientFiles.id,
              fileType: patientFiles.fileType,
              title: patientFiles.title,
              storageKey: patientFiles.storageKey,
              mimeType: patientFiles.mimeType,
              toothNumber: patientFiles.toothNumber,
              photoStage: patientFiles.photoStage,
              pairId: patientFiles.pairId,
              createdAt: patientFiles.createdAt,
            })
            .from(patientFiles)
            .where(eq(patientFiles.patientId, id))
            .orderBy(desc(patientFiles.createdAt))
            .limit(24)
        : Promise.resolve([]),

      db
        .select({
          id: recalls.id,
          recallType: recalls.recallType,
          dueDate: recalls.dueDate,
          status: recalls.status,
        })
        .from(recalls)
        .where(and(eq(recalls.patientId, id), eq(recalls.status, RECALL_STATUS.PENDING)))
        .orderBy(recalls.dueDate)
        .limit(5),
    ]);

    const statusCounts = Object.fromEntries(
      (appointmentStats as { status: string; n: number }[]).map((r) => [r.status, Number(r.n)])
    );

    const totals = (invoiceTotals as { billed: number; paid: number; openCount: number }[])[0];
    const allocated = (paymentRows as { type: string; amount: number; invoiceId: string | null }[]);

    const unallocatedCredit = allocated
      .filter((p) => p.invoiceId === null)
      .reduce((sum, p) => sum + signedAmount(p), 0);

    const outstanding = Number(totals?.billed ?? 0) - Number(totals?.paid ?? 0);

    return NextResponse.json({
      patient,
      permissions: {
        clinical: canClinical,
        billing: canBilling,
        plans: canPlans,
        files: canFiles,
        appointments: canAppointments,
      },
      alerts: alerts.filter((c) => c.isAlert),
      conditions: alerts,
      chart,
      visits: recentVisits,
      treatmentPlans: plans,
      appointments: { upcoming, past: pastAppointments },
      appointmentStats: {
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        completed: statusCounts[APPOINTMENT_STATUS.COMPLETED] ?? 0,
        noShow: statusCounts[APPOINTMENT_STATUS.NO_SHOW] ?? 0,
        cancelled: statusCounts[APPOINTMENT_STATUS.CANCELLED] ?? 0,
      },
      billing: canBilling
        ? {
            billed: Number(totals?.billed ?? 0),
            paid: Number(totals?.paid ?? 0),
            outstanding,
            unallocatedCredit,
            // What the patient actually owes, once credit on account is applied.
            netBalance: outstanding - unallocatedCredit,
            openInvoices: Number(totals?.openCount ?? 0),
          }
        : null,
      files,
      recalls: dueRecalls,
    });
  }
);
