import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminRoles, adminUsers } from '@/lib/schema';
import { withAuth, invalidateStaffCache } from '@/lib/rbac';
import {
  PERMISSIONS,
  parsePermissions,
  LOCKOUT_CRITICAL_PERMISSIONS,
} from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import { clinicNow } from '@/lib/datetime';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';

const schema = z.object({ isActive: z.boolean() });

type Params = { params: Promise<{ id: string }> };

/**
 * Activate or deactivate a staff member.
 *
 * Deactivation is the ONLY way access ends — hard delete returns 405, because
 * ~15 tables reference admin_users.id with no foreign keys and deleting a
 * person orphans every clinical record and audit row they ever touched.
 *
 * Takes effect on the person's NEXT REQUEST: requirePermission re-reads
 * isActive on every call (behind a 5-second cache, invalidated here), so this
 * does not wait for their 8-hour token to expire.
 */
export const POST = withAuth(PERMISSIONS.STAFF_MANAGE, async (req, ctx, { params }: Params) => {
  const { id } = await params;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Specify isActive as true or false.' }, { status: 400 });
  }
  const { isActive } = parsed.data;

  const [target] = await db
    .select({
      id: adminUsers.id,
      name: adminUsers.name,
      email: adminUsers.email,
      isActive: adminUsers.isActive,
      roleId: adminUsers.roleId,
      permissions: adminRoles.permissions,
    })
    .from(adminUsers)
    .leftJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
    .where(eq(adminUsers.id, id))
    .limit(1);

  if (!target) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 });
  if (Boolean(target.isActive) === isActive) {
    return NextResponse.json({ message: 'No change.' });
  }

  if (!isActive) {
    // Guard 1: you cannot deactivate yourself. The person locking accounts
    // must always be able to undo their last click.
    if (id === ctx.userId) {
      return NextResponse.json(
        { error: 'You cannot deactivate your own account.', code: 'SELF_LOCKOUT' },
        { status: 409 }
      );
    }

    // Guard 2: never deactivate the last active holder of staff_manage or
    // roles_manage. With nobody able to grant access, the clinic is locked
    // out of its own administration with no way back short of SQL by hand.
    const targetPermissions = parsePermissions(target.permissions);
    for (const critical of LOCKOUT_CRITICAL_PERMISSIONS) {
      if (!targetPermissions.includes(critical)) continue;

      const others = await db
        .select({ permissions: adminRoles.permissions })
        .from(adminUsers)
        .innerJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
        .where(and(ne(adminUsers.id, id), eq(adminUsers.isActive, true)));

      const someoneElse = others.some((row) =>
        parsePermissions(row.permissions).includes(critical)
      );
      if (!someoneElse) {
        return NextResponse.json(
          {
            error:
              `${target.name ?? target.email} is the last active person who can ` +
              `${critical === 'staff_manage' ? 'manage staff' : 'manage roles'}. ` +
              `Give that permission to someone else first.`,
            code: 'WOULD_LOCK_OUT',
          },
          { status: 409 }
        );
      }
    }
  }

  await db
    .update(adminUsers)
    .set({ isActive, updatedAt: clinicNow() })
    .where(eq(adminUsers.id, id));

  // Their very next request re-reads the row.
  invalidateStaffCache(id);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.UPDATE,
    entityType: AUDIT_ENTITY.ADMIN_USER,
    entityId: id,
    before: { isActive: Boolean(target.isActive) },
    after: { isActive },
    request: req,
  });

  return NextResponse.json({ id, isActive });
});
