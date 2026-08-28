import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { communicationLogs, leads, patients } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { desc, eq } from 'drizzle-orm';

/**
 * The clinic-wide message log: what was sent, to whom, and whether it arrived.
 * The skipped rows here are the phone-first call list.
 */
export const GET = withAuth(PERMISSIONS.LEADS_VIEW, async (req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const rows = await db
    .select({
      id: communicationLogs.id,
      channel: communicationLogs.channel,
      direction: communicationLogs.direction,
      subject: communicationLogs.subject,
      status: communicationLogs.status,
      templateKey: communicationLogs.templateKey,
      createdAt: communicationLogs.createdAt,
      patientId: communicationLogs.patientId,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      patientPhone: patients.phone,
      leadId: communicationLogs.leadId,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
    .from(communicationLogs)
    .leftJoin(patients, eq(communicationLogs.patientId, patients.id))
    .leftJoin(leads, eq(communicationLogs.leadId, leads.id))
    .where(status ? eq(communicationLogs.status, status) : undefined)
    .orderBy(desc(communicationLogs.createdAt))
    .limit(200);

  return NextResponse.json(rows);
});
