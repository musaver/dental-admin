import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appointments } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { loadAppointment } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import { APPOINTMENT_STATUS, AUDIT_ACTION, AUDIT_ENTITY, valuesOf } from '@/lib/enums';
import { applyStatusChange, canTransition } from '@/lib/appointments';
import { unlinkAppointmentFromPlanItem } from '@/lib/derive';
import { completeRecallForAppointment, unlinkRecallFromAppointment } from '@/lib/recalls';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const schema = z.object({
  status: z.enum(valuesOf(APPOINTMENT_STATUS) as [string, ...string[]]),
  reason: z.string().max(255).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(null, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const before = await loadAppointment(ctx, id);

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { status, reason } = parsed.data;

  // Cancelling is a separate permission from editing, because a receptionist
  // may need to move an appointment without being able to call it off.
  const required =
    status === APPOINTMENT_STATUS.CANCELLED
      ? PERMISSIONS.APPOINTMENTS_CANCEL
      : PERMISSIONS.APPOINTMENTS_EDIT;

  if (!hasPermission(ctx.permissions, required)) {
    return NextResponse.json(
      { error: 'You do not have permission to do that.', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  // A repeat of the same status is a no-op, not an error — a double-click
  // should not restamp a timestamp.
  if (before.status === status) {
    return NextResponse.json(before);
  }

  if (!canTransition(before.status, status)) {
    return NextResponse.json(
      {
        error: `An appointment that is ${before.status.replace(/_/g, ' ')} cannot become ${status.replace(/_/g, ' ')}.`,
        code: 'ILLEGAL_TRANSITION',
      },
      { status: 409 }
    );
  }

  if (status === APPOINTMENT_STATUS.CANCELLED && !reason?.trim()) {
    return NextResponse.json(
      { error: 'Give a reason for the cancellation.', details: { reason: ['Required'] } },
      { status: 400 }
    );
  }

  const now = clinicNow();
  let recallClosed = false;
  const patch = applyStatusChange({
    from: before.status,
    to: status as never,
    now,
    actorId: ctx.userId,
    reason,
    existing: { confirmedAt: before.confirmedAt, checkedInAt: before.checkedInAt },
  });

  await db.transaction(async (tx) => {
    await tx
      .update(appointments)
      .set({ ...patch, updatedAt: now })
      .where(eq(appointments.id, id));

    if (status === APPOINTMENT_STATUS.CANCELLED) {
      // Release what this appointment was holding: the plan item returns to
      // pending, and the recall goes back on the worklist. Both sides of each
      // pair, in this transaction.
      if (before.treatmentPlanItemId) {
        await unlinkAppointmentFromPlanItem(tx, id, before.treatmentPlanItemId);
      }
      if (before.recallId) {
        await unlinkRecallFromAppointment(tx, before.recallId, id);
      }
    } else if (status === APPOINTMENT_STATUS.COMPLETED && before.recallId) {
      // The recall has been answered. Not every completion comes through a
      // visit — a checkup can be closed straight from the diary — so this
      // route has to close it too, or the recall sits at 'booked' for ever.
      // The pointer pair stays intact; see lib/recalls.ts.
      recallClosed = await completeRecallForAppointment(tx, before.recallId, id);
    }
  });

  const after = await loadAppointment(ctx, id);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.UPDATE,
    entityType: AUDIT_ENTITY.APPOINTMENT,
    entityId: id,
    patientId: before.patientId,
    branchId: before.branchId,
    before: { status: before.status },
    after: {
      status: after.status,
      ...(reason ? { reason } : {}),
      ...(recallClosed ? { recallClosedId: before.recallId } : {}),
    },
    request: req,
  });

  return NextResponse.json(after);
});
