import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { branches, chairs, clinicSettings } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { invalidateClinicIdentity } from '@/lib/email';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/** clinic_settings is a single row keyed 'default'. */
const SETTINGS_ID = 'default';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const schema = z.object({
  clinicName: z.string().trim().min(1).max(255).optional(),
  address: z.string().max(65_535).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email().max(255).nullable().optional().or(z.literal('').transform(() => null)),
  workStartTime: z.string().regex(HHMM).optional(),
  workEndTime: z.string().regex(HHMM).optional(),
  slotMinutes: z.coerce.number().int().min(5).max(120).optional(),
});

export const GET = withAuth(PERMISSIONS.SETTINGS_MANAGE, async () => {
  const [settings] = await db.select().from(clinicSettings).limit(1);
  const [branchRows, chairRows] = await Promise.all([
    db.select().from(branches).orderBy(branches.name),
    db.select().from(chairs).orderBy(chairs.name),
  ]);
  return NextResponse.json({ settings, branches: branchRows, chairs: chairRows });
});

export const PUT = withAuth(PERMISSIONS.SETTINGS_MANAGE, async (req, ctx) => {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  if (parsed.data.workStartTime && parsed.data.workEndTime &&
      parsed.data.workStartTime >= parsed.data.workEndTime) {
    return NextResponse.json(
      { error: 'Closing time must be after opening time.', details: { workEndTime: ['Invalid'] } },
      { status: 400 }
    );
  }

  await db
    .update(clinicSettings)
    .set({ ...parsed.data, updatedAt: clinicNow() })
    .where(eq(clinicSettings.id, SETTINGS_ID));

  // The email letterhead reads the clinic name; drop its cache.
  invalidateClinicIdentity();

  const [after] = await db.select().from(clinicSettings).limit(1);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.UPDATE,
    entityType: AUDIT_ENTITY.CLINIC_SETTINGS,
    entityId: SETTINGS_ID,
    after: parsed.data,
    request: req,
  });

  return NextResponse.json(after);
});
