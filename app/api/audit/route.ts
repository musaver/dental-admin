import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/schema';
import { withAuth, resolveBranchScope } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { auditView } from '@/lib/audit';
import { AUDIT_ENTITY } from '@/lib/enums';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

/**
 * The audit trail.
 *
 * KEYSET pagination (createdAt+id cursor), not OFFSET: this is the
 * fastest-growing table in the database, and OFFSET 100000 rescans everything
 * it skips. The cursor rides the (patientId, createdAt) / (actorId, createdAt)
 * indexes instead.
 *
 * Opening the audit log is itself audited — the first thing a real auditor
 * asks is who has been reading the record of who reads records.
 */
export const GET = withAuth(PERMISSIONS.AUDIT_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));

  const patientId = url.searchParams.get('patientId');
  const actorId = url.searchParams.get('actorId');
  const action = url.searchParams.get('action');
  const entityType = url.searchParams.get('entityType');
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

  const filters = [];
  if (branchIds) {
    // audit_logs.branchId is nullable (system-level events have no branch);
    // scoped staff still see those, since they carry no other branch's data.
    filters.push(
      or(inArray(auditLogs.branchId, branchIds), sql`${auditLogs.branchId} IS NULL`)!
    );
  }
  if (patientId) filters.push(eq(auditLogs.patientId, patientId));
  if (actorId) filters.push(eq(auditLogs.actorId, actorId));
  if (action) filters.push(eq(auditLogs.action, action));
  if (entityType) filters.push(eq(auditLogs.entityType, entityType));

  if (cursor) {
    const [ts, id] = cursor.split('_');
    const at = new Date(Number(ts));
    filters.push(
      or(
        lt(auditLogs.createdAt, at),
        and(eq(auditLogs.createdAt, at), lt(auditLogs.id, id ?? ''))
      )!
    );
  }

  const rows = await db
    .select()
    .from(auditLogs)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last?.createdAt ? `${last.createdAt.getTime()}_${last.id}` : null;

  await auditView(ctx, AUDIT_ENTITY.CLINIC, 'audit-log', { request: req });

  return NextResponse.json({ rows: page, nextCursor });
});
