import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { recalls } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { canAccessBranch } from '@/lib/branch-scope';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY, RECALL_STATUS, valuesOf } from '@/lib/enums';
import { addMonthsClamped, clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const schema = z.object({
  status: z.enum(valuesOf(RECALL_STATUS) as [string, ...string[]]).optional(),
  /** Push the due date out by this many months ("call back in spring"). */
  snoozeMonths: z.coerce.number().int().min(1).max(24).optional(),
  notes: z.string().max(500).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PATCH = withAuth(PERMISSIONS.RECALLS_MANAGE, async (req, ctx, { params }: Params) => {
  const { id } = await params;

  const [before] = await db.select().from(recalls).where(eq(recalls.id, id)).limit(1);
  if (!before || !canAccessBranch(ctx, before.branchId)) {
    return NextResponse.json({ error: 'Recall not found.' }, { status: 404 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });
  }
  const input = parsed.data;
  const now = clinicNow();

  const patch: Record<string, unknown> = { updatedAt: now };
  if (input.status) patch.status = input.status;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.snoozeMonths) {
    patch.dueDate = addMonthsClamped(before.dueDate, input.snoozeMonths);
    patch.status = RECALL_STATUS.PENDING;
  }

  await db.update(recalls).set(patch).where(eq(recalls.id, id));
  const [after] = await db.select().from(recalls).where(eq(recalls.id, id)).limit(1);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.UPDATE,
    entityType: AUDIT_ENTITY.RECALL,
    entityId: id,
    patientId: before.patientId,
    branchId: before.branchId,
    before,
    after,
    request: req,
  });

  return NextResponse.json(after);
});
