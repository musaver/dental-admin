import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, leads, procedures } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  LEAD_SOURCE,
  LEAD_STATUS,
  OPEN_LEAD_STATUSES,
  valuesOf,
} from '@/lib/enums';
import { normalizePhone } from '@/lib/patient-identity';
import { parsePageParams, parseSearch, paginate } from '@/lib/pagination';
import { clinicNow } from '@/lib/datetime';
import { and, desc, eq, inArray, like, lte, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the enquiry a name').max(255),
  phone: z.string().trim().min(6, 'A contact number is required').max(20),
  email: z.string().trim().email().max(255).nullable().optional().or(z.literal('').transform(() => null)),
  source: z.enum(valuesOf(LEAD_SOURCE) as [string, ...string[]]).default(LEAD_SOURCE.WALK_IN),
  interestedProcedureId: z.string().max(255).nullable().optional(),
  interestNote: z.string().max(255).nullable().optional(),
  assignedTo: z.string().max(255).nullable().optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
  branchId: z.string().max(255).optional(),
});

export const GET = withAuth(PERMISSIONS.LEADS_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const page = parsePageParams(url);
  const search = parseSearch(url);
  const status = url.searchParams.get('status');
  const assignedTo = url.searchParams.get('assignedTo');
  // The daily driver: everything whose follow-up has come due.
  const dueOnly = url.searchParams.get('due') === '1';

  const filters = [];
  if (branchIds) filters.push(inArray(leads.branchId, branchIds));
  if (status && status !== 'all') filters.push(inArray(leads.status, status.split(',')));
  if (assignedTo) filters.push(eq(leads.assignedTo, assignedTo));
  if (dueOnly) {
    filters.push(lte(leads.nextFollowUpAt, clinicNow()));
    filters.push(inArray(leads.status, OPEN_LEAD_STATUSES as string[]));
  }
  if (search) {
    const digits = search.replace(/\D/g, '');
    const conditions = [like(leads.name, `%${search}%`)];
    if (digits.length >= 4) {
      conditions.push(sql`REGEXP_REPLACE(${leads.phone}, '[^0-9]', '') LIKE ${`%${digits}%`}`);
    }
    filters.push(or(...conditions)!);
  }
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        source: leads.source,
        status: leads.status,
        interestNote: leads.interestNote,
        nextFollowUpAt: leads.nextFollowUpAt,
        convertedPatientId: leads.convertedPatientId,
        convertedAt: leads.convertedAt,
        lostReason: leads.lostReason,
        createdAt: leads.createdAt,
        assignedTo: leads.assignedTo,
        assigneeName: adminUsers.name,
        procedureName: procedures.name,
      })
      .from(leads)
      .leftJoin(adminUsers, eq(leads.assignedTo, adminUsers.id))
      .leftJoin(procedures, eq(leads.interestedProcedureId, procedures.id))
      .where(where)
      .orderBy(desc(leads.createdAt))
      .limit(page.pageSize)
      .offset(page.offset),
    db.select({ n: sql<number>`count(*)` }).from(leads).where(where),
  ]);

  return NextResponse.json(paginate(rows, Number(counted?.n ?? 0), page));
});

export const POST = withAuth(PERMISSIONS.LEADS_EDIT, async (req, ctx) => {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const branchId = ctx.isHeadOffice ? input.branchId : ctx.branchId;
  if (!branchId) {
    return NextResponse.json(
      { error: 'Choose which branch this enquiry belongs to.', details: { branchId: ['Required'] } },
      { status: 400 }
    );
  }

  const now = clinicNow();
  const row = {
    id: uuidv4(),
    branchId,
    name: input.name,
    // Normalised the same way as a patient's, so converting later finds the
    // right duplicate candidates.
    phone: normalizePhone(input.phone)!,
    email: input.email ?? null,
    source: input.source,
    interestedProcedureId: input.interestedProcedureId ?? null,
    interestNote: input.interestNote ?? null,
    status: LEAD_STATUS.NEW,
    lostReason: null,
    assignedTo: input.assignedTo ?? null,
    nextFollowUpAt: input.nextFollowUpAt ?? null,
    metadata: null,
    convertedPatientId: null,
    convertedAt: null,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(leads).values(row);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.LEAD,
    entityId: row.id,
    branchId,
    after: row,
    request: req,
  });

  return NextResponse.json(row, { status: 201 });
});
