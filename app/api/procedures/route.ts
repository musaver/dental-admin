import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { procedures } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY, PROCEDURE_CATEGORY, valuesOf } from '@/lib/enums';
import { clinicNow } from '@/lib/datetime';
import { and, asc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const createSchema = z.object({
  code: z.string().max(20).nullable().optional(),
  name: z.string().trim().min(1, 'Name the procedure').max(255),
  category: z.enum(valuesOf(PROCEDURE_CATEGORY) as [string, ...string[]]),
  defaultPrice: z.coerce.number().int().min(0),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  isPerTooth: z.boolean().optional(),
  defaultRecallMonths: z.coerce.number().int().min(1).max(120).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * The price list.
 *
 * Readable by any signed-in staff member rather than gated on
 * procedures_manage: booking needs durations and quoting needs prices, so a
 * receptionist who can do neither still has to read this.
 */
export const GET = withAuth(null, async (req) => {
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get('all') === '1';
  const category = url.searchParams.get('category');

  const rows = await db
    .select()
    .from(procedures)
    .where(
      and(
        includeInactive ? undefined : eq(procedures.isActive, true),
        category ? eq(procedures.category, category) : undefined
      )
    )
    .orderBy(asc(procedures.category), asc(procedures.name));

  return NextResponse.json(rows);
});

export const POST = withAuth(PERMISSIONS.PROCEDURES_MANAGE, async (req, ctx) => {
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
    code: input.code ?? null,
    name: input.name,
    category: input.category,
    // Whole PKR, never paisa.
    defaultPrice: input.defaultPrice,
    durationMinutes: input.durationMinutes ?? 30,
    isPerTooth: input.isPerTooth ?? true,
    defaultRecallMonths: input.defaultRecallMonths ?? null,
    isActive: input.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(procedures).values(row);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.PROCEDURE,
    entityId: row.id,
    after: row,
    request: req,
  });

  return NextResponse.json(row, { status: 201 });
});
