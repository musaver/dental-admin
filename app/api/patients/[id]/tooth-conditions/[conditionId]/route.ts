import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toothConditions } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadPatient, loadToothCondition } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  TOOTH_CONDITION_STATUS,
  valuesOf,
} from '@/lib/enums';
import { packSurfaces, parseSurfaces } from '@/lib/odontogram';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const updateSchema = z.object({
  status: z.enum(valuesOf(TOOTH_CONDITION_STATUS) as [string, ...string[]]).optional(),
  surfaces: z.string().max(10).nullable().optional(),
  notes: z.string().max(65_535).nullable().optional(),
  resolvedByVisitId: z.string().max(255).nullable().optional(),
});

type Params = { params: Promise<{ id: string; conditionId: string }> };

export const PATCH = withAuth(
  PERMISSIONS.CLINICAL_EDIT,
  async (req, ctx, { params }: Params) => {
    const { id, conditionId } = await params;
    const patient = await loadPatient(ctx, id);
    const before = await loadToothCondition(ctx, conditionId);

    if (before.patientId !== id) {
      return NextResponse.json({ error: 'Tooth condition not found.' }, { status: 404 });
    }

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const input = parsed.data;
    const now = clinicNow();

    const patch: Record<string, unknown> = {};
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.surfaces !== undefined) patch.surfaces = packSurfaces(parseSurfaces(input.surfaces));
    if (input.resolvedByVisitId !== undefined) patch.resolvedByVisitId = input.resolvedByVisitId;

    if (input.status !== undefined) {
      patch.status = input.status;
      // Leaving 'active' closes the finding out; resolvedAt is what makes the
      // per-tooth history readable later.
      patch.resolvedAt = input.status === TOOTH_CONDITION_STATUS.ACTIVE ? null : now;
    }

    await db.update(toothConditions).set(patch).where(eq(toothConditions.id, conditionId));
    const [after] = await db
      .select()
      .from(toothConditions)
      .where(eq(toothConditions.id, conditionId))
      .limit(1);

    await writeAuditLog({
      actor: ctx,
      action: AUDIT_ACTION.UPDATE,
      entityType: AUDIT_ENTITY.TOOTH_CONDITION,
      entityId: conditionId,
      patientId: id,
      branchId: patient.branchId,
      before,
      after,
      request: req,
    });

    return NextResponse.json(after);
  }
);

/**
 * Delete only corrects a mis-click. Clinically, a finding that is no longer
 * present should be RESOLVED (PATCH status), which keeps it in the tooth's
 * history; deleting it erases the record that it was ever there.
 */
export const DELETE = withAuth(
  PERMISSIONS.CLINICAL_EDIT,
  async (req, ctx, { params }: Params) => {
    const { id, conditionId } = await params;
    const patient = await loadPatient(ctx, id);
    const before = await loadToothCondition(ctx, conditionId);

    if (before.patientId !== id) {
      return NextResponse.json({ error: 'Tooth condition not found.' }, { status: 404 });
    }

    await db.delete(toothConditions).where(eq(toothConditions.id, conditionId));

    await writeAuditLog({
      actor: ctx,
      action: AUDIT_ACTION.DELETE,
      entityType: AUDIT_ENTITY.TOOTH_CONDITION,
      entityId: conditionId,
      patientId: id,
      branchId: patient.branchId,
      before,
      request: req,
    });

    return NextResponse.json({ message: 'Finding removed.' });
  }
);
