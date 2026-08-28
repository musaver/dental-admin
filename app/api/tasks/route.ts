import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, tasks } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { TASK_PRIORITY, TASK_STATUS, valuesOf } from '@/lib/enums';
import { clinicNow } from '@/lib/datetime';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

/**
 * Internal to-dos. Rewritten for the dental tasks shape (patientId / leadId /
 * branchId / assignedTo); the old education version wrote classId /
 * attachmentUrl / announcementSent, none of which exist here.
 *
 * Note: this is deliberately NOT the lead follow-up queue - leads.nextFollowUpAt
 * is that. Tasks cover what the lead worklist does not ("chase the lab about
 * Ali's crown"). Two writable to-do lists is the classic CRM failure.
 */
const createSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(255),
  description: z.string().max(65_535).nullable().optional(),
  patientId: z.string().max(255).nullable().optional(),
  leadId: z.string().max(255).nullable().optional(),
  assignedTo: z.string().max(255).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  priority: z.enum(valuesOf(TASK_PRIORITY) as [string, ...string[]]).default('normal'),
});

export const GET = withAuth(null, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const mine = url.searchParams.get('mine') === '1';
  const status = url.searchParams.get('status');

  const filters = [];
  if (branchIds) filters.push(inArray(tasks.branchId, branchIds));
  if (mine) filters.push(eq(tasks.assignedTo, ctx.userId));
  if (status === 'open') filters.push(ne(tasks.status, 'done'));
  else if (status) filters.push(eq(tasks.status, status));

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      patientId: tasks.patientId,
      leadId: tasks.leadId,
      assignedTo: tasks.assignedTo,
      assigneeName: adminUsers.name,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .leftJoin(adminUsers, eq(tasks.assignedTo, adminUsers.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(tasks.status), desc(tasks.priority), asc(tasks.dueDate))
    .limit(200);

  return NextResponse.json(rows);
});

export const POST = withAuth(null, async (req, ctx) => {
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
    title: input.title,
    description: input.description ?? null,
    patientId: input.patientId ?? null,
    leadId: input.leadId ?? null,
    branchId: ctx.branchId,
    assignedTo: input.assignedTo ?? ctx.userId,
    dueDate: input.dueDate ?? null,
    status: TASK_STATUS.OPEN,
    priority: input.priority,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(tasks).values(row);

  // Deliberately not audited: tasks are internal to-dos, outside the
  // clinical/financial audit matrix.
  return NextResponse.json(row, { status: 201 });
});

export const PATCH = withAuth(null, async (req, ctx) => {
  const body = await req.json();
  const schema = z.object({
    id: z.string(),
    status: z.enum(valuesOf(TASK_STATUS) as [string, ...string[]]),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  await db
    .update(tasks)
    .set({ status: parsed.data.status, updatedAt: clinicNow() })
    .where(eq(tasks.id, parsed.data.id));

  return NextResponse.json({ id: parsed.data.id, status: parsed.data.status });
});
