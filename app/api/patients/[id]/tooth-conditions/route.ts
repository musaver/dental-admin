import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toothConditions } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadPatient } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  TOOTH_CONDITION_STATUS,
  TOOTH_CONDITION_TYPE,
  valuesOf,
} from '@/lib/enums';
import { isValidToothNumber, packSurfaces, parseSurfaces } from '@/lib/odontogram';
import { clinicNow } from '@/lib/datetime';
import { and, desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const createSchema = z.object({
  toothNumber: z.string().refine(isValidToothNumber, 'Not a valid FDI tooth number'),
  conditionType: z.enum(valuesOf(TOOTH_CONDITION_TYPE) as [string, ...string[]]),
  surfaces: z.string().max(10).nullable().optional(),
  notes: z.string().max(65_535).nullable().optional(),
  visitId: z.string().max(255).nullable().optional(),
  diagnosisId: z.string().max(255).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(PERMISSIONS.CLINICAL_VIEW, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  await loadPatient(ctx, id);

  const url = new URL(req.url);
  // The chart is the active rows; ?history=1 returns resolved ones too.
  const includeHistory = url.searchParams.get('history') === '1';

  const rows = await db
    .select()
    .from(toothConditions)
    .where(
      includeHistory
        ? eq(toothConditions.patientId, id)
        : and(
            eq(toothConditions.patientId, id),
            eq(toothConditions.status, TOOTH_CONDITION_STATUS.ACTIVE)
          )
    )
    .orderBy(toothConditions.toothNumber, desc(toothConditions.recordedAt));

  return NextResponse.json(rows);
});

export const POST = withAuth(PERMISSIONS.CLINICAL_EDIT, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const patient = await loadPatient(ctx, id);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const now = clinicNow();

  const row = {
    id: uuidv4(),
    patientId: id,
    toothNumber: input.toothNumber,
    // Re-pack so the stored order is canonical whatever the client sent.
    surfaces: packSurfaces(parseSurfaces(input.surfaces)),
    conditionType: input.conditionType,
    status: TOOTH_CONDITION_STATUS.ACTIVE,
    notes: input.notes ?? null,
    visitId: input.visitId ?? null,
    diagnosisId: input.diagnosisId ?? null,
    treatmentPlanItemId: null,
    resolvedByVisitId: null,
    resolvedAt: null,
    recordedBy: ctx.userId,
    recordedAt: now,
    createdAt: now,
  };

  await db.insert(toothConditions).values(row);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.TOOTH_CONDITION,
    entityId: row.id,
    patientId: id,
    branchId: patient.branchId,
    after: row,
    request: req,
  });

  return NextResponse.json(row, { status: 201 });
});
