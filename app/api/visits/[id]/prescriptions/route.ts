import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { prescriptionItems, prescriptions } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadVisit } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import { clinicNow } from '@/lib/datetime';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

/**
 * prescriptions.visitId is NOT NULL: a prescription cannot exist outside a
 * visit, which is why this is nested under one rather than being a top-level
 * resource.
 *
 * drugName is free text — there is no drug catalogue in this schema — so the
 * only validation possible is length.
 */
const schema = z.object({
  dentistId: z.string().max(255).optional(),
  notes: z.string().max(65_535).nullable().optional(),
  items: z
    .array(
      z.object({
        drugName: z.string().trim().min(1, 'Name the medicine').max(255),
        dosage: z.string().max(100).nullable().optional(),
        frequency: z.string().max(100).nullable().optional(),
        durationDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
        instructions: z.string().max(255).nullable().optional(),
      })
    )
    .min(1, 'A prescription needs at least one medicine'),
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
  const input = parsed.data;
  const now = clinicNow();

  const header = {
    id: uuidv4(),
    visitId: id,
    patientId: visit.patientId,
    dentistId: input.dentistId ?? visit.dentistId,
    notes: input.notes ?? null,
    createdAt: now,
  };

  // sortOrder is what the printed sheet is ordered by, so it follows the
  // order the dentist entered them.
  const lines = input.items.map((item, index) => ({
    id: uuidv4(),
    prescriptionId: header.id,
    drugName: item.drugName,
    dosage: item.dosage ?? null,
    frequency: item.frequency ?? null,
    durationDays: item.durationDays ?? null,
    instructions: item.instructions ?? null,
    sortOrder: index,
    createdAt: now,
  }));

  await db.transaction(async (tx) => {
    await tx.insert(prescriptions).values(header);
    await tx.insert(prescriptionItems).values(lines);
  });

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.PRESCRIPTION,
    entityId: header.id,
    patientId: visit.patientId,
    branchId: visit.branchId,
    after: { ...header, items: lines.map((l) => l.drugName) },
    request: req,
  });

  return NextResponse.json({ ...header, items: lines }, { status: 201 });
});
