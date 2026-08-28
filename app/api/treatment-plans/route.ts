import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, patients, treatmentPlans } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadPatient } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY, TREATMENT_PLAN_STATUS } from '@/lib/enums';
import { parsePageParams, paginate } from '@/lib/pagination';
import { clinicNow } from '@/lib/datetime';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const createSchema = z.object({
  patientId: z.string().min(1).max(255),
  title: z.string().trim().min(1, 'Give the plan a title').max(255),
  dentistId: z.string().min(1).max(255),
  notes: z.string().max(65_535).nullable().optional(),
});

export const GET = withAuth(PERMISSIONS.TREATMENT_PLANS_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const page = parsePageParams(url);
  const patientId = url.searchParams.get('patientId');
  const status = url.searchParams.get('status');

  const filters = [];
  if (branchIds) filters.push(inArray(treatmentPlans.branchId, branchIds));
  if (patientId) filters.push(eq(treatmentPlans.patientId, patientId));
  if (status && status !== 'all') filters.push(eq(treatmentPlans.status, status));
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: treatmentPlans.id,
        title: treatmentPlans.title,
        status: treatmentPlans.status,
        totalAmount: treatmentPlans.totalAmount,
        discountTotal: treatmentPlans.discountTotal,
        netAmount: treatmentPlans.netAmount,
        proposedAt: treatmentPlans.proposedAt,
        acceptedAt: treatmentPlans.acceptedAt,
        createdAt: treatmentPlans.createdAt,
        patientId: treatmentPlans.patientId,
        patientMrn: patients.mrn,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        dentistName: adminUsers.name,
      })
      .from(treatmentPlans)
      .leftJoin(patients, eq(treatmentPlans.patientId, patients.id))
      .leftJoin(adminUsers, eq(treatmentPlans.dentistId, adminUsers.id))
      .where(where)
      .orderBy(desc(treatmentPlans.createdAt))
      .limit(page.pageSize)
      .offset(page.offset),
    db.select({ n: sql<number>`count(*)` }).from(treatmentPlans).where(where),
  ]);

  return NextResponse.json(paginate(rows, Number(counted?.n ?? 0), page));
});

export const POST = withAuth(PERMISSIONS.TREATMENT_PLANS_EDIT, async (req, ctx) => {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Branch comes from the patient, never from the request.
  const patient = await loadPatient(ctx, input.patientId);
  const now = clinicNow();

  const row = {
    id: uuidv4(),
    patientId: patient.id,
    branchId: patient.branchId,
    dentistId: input.dentistId,
    title: input.title,
    status: TREATMENT_PLAN_STATUS.DRAFT,
    totalAmount: 0,
    discountTotal: 0,
    netAmount: 0,
    proposedAt: null,
    acceptedAt: null,
    acceptedNote: null,
    consentFileId: null,
    cancelReason: null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(treatmentPlans).values(row);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.TREATMENT_PLAN,
    entityId: row.id,
    patientId: patient.id,
    branchId: patient.branchId,
    after: row,
    request: req,
  });

  return NextResponse.json(row, { status: 201 });
});
