import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { visitDiagnoses } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadVisit } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import { isValidToothNumber } from '@/lib/odontogram';
import { clinicNow } from '@/lib/datetime';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const schema = z.object({
  // Nullable: a diagnosis can be whole-mouth rather than about one tooth.
  toothNumber: z
    .string()
    .refine(isValidToothNumber, 'Not a valid FDI tooth number')
    .nullable()
    .optional(),
  code: z.string().max(20).nullable().optional(),
  description: z.string().trim().min(1, 'Describe the diagnosis').max(500),
});

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(PERMISSIONS.CLINICAL_EDIT, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const visit = await loadVisit(ctx, id);

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const row = {
    id: uuidv4(),
    visitId: id,
    patientId: visit.patientId,
    toothNumber: parsed.data.toothNumber ?? null,
    code: parsed.data.code ?? null,
    description: parsed.data.description,
    createdAt: clinicNow(),
  };

  await db.insert(visitDiagnoses).values(row);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.VISIT_DIAGNOSIS,
    entityId: row.id,
    patientId: visit.patientId,
    branchId: visit.branchId,
    after: row,
    request: req,
  });

  return NextResponse.json(row, { status: 201 });
});
