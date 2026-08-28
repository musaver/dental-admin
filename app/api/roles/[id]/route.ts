import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminRoles, adminUsers } from '@/lib/schema';
import { withAuth, invalidateStaffCache } from '@/lib/rbac';
import {
  PERMISSIONS,
  parsePermissions,
  serializePermissions,
  LOCKOUT_CRITICAL_PERMISSIONS,
} from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import { clinicNow } from '@/lib/datetime';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

const roleSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  permissions: z.array(z.string()).optional(),
});

type Params = { params: Promise<{ id: string }> };

async function loadRole(id: string) {
  const [row] = await db.select().from(adminRoles).where(eq(adminRoles.id, id)).limit(1);
  return row ?? null;
}

/**
 * How many ACTIVE staff would still hold `permission` if this role no longer
 * did. Used to stop the clinic locking itself out of its own administration —
 * with no other route back in short of running SQL by hand.
 */
async function othersHolding(roleId: string, permission: string): Promise<number> {
  const rows = await db
    .select({ permissions: adminRoles.permissions, n: sql<number>`count(*)` })
    .from(adminUsers)
    .innerJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
    .where(and(ne(adminRoles.id, roleId), eq(adminUsers.isActive, true)))
    .groupBy(adminRoles.permissions);

  return rows
    .filter((r) => parsePermissions(r.permissions).includes(permission as never))
    .reduce((total, r) => total + Number(r.n), 0);
}

export const GET = withAuth(PERMISSIONS.ROLES_MANAGE, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const role = await loadRole(id);
  if (!role) return NextResponse.json({ error: 'Role not found.' }, { status: 404 });
  return NextResponse.json({ ...role, permissions: parsePermissions(role.permissions) });
});

export const PUT = withAuth(PERMISSIONS.ROLES_MANAGE, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const before = await loadRole(id);
  if (!before) return NextResponse.json({ error: 'Role not found.' }, { status: 404 });

  const parsed = roleSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = { updatedAt: clinicNow() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;

  if (parsed.data.permissions !== undefined) {
    const next = serializePermissions(parsed.data.permissions);
    const nextSet = parsePermissions(next);

    // Removing the last holder of staff_manage or roles_manage would leave
    // nobody able to grant it back.
    for (const critical of LOCKOUT_CRITICAL_PERMISSIONS) {
      const hadIt = parsePermissions(before.permissions).includes(critical);
      const losingIt = hadIt && !nextSet.includes(critical);
      if (!losingIt) continue;

      if ((await othersHolding(id, critical)) === 0) {
        return NextResponse.json(
          {
            error:
              `Removing "${critical}" from this role would leave no active staff able to ` +
              `manage access. Grant it to another role first.`,
            code: 'WOULD_LOCK_OUT',
          },
          { status: 409 }
        );
      }
    }

    patch.permissions = next;
  }

  await db.update(adminRoles).set(patch).where(eq(adminRoles.id, id));
  const after = await loadRole(id);

  // Permissions are cached per user for a few seconds; drop the whole cache so
  // a role change takes effect on the next request rather than after the TTL.
  invalidateStaffCache();

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.UPDATE,
    entityType: AUDIT_ENTITY.ADMIN_ROLE,
    entityId: id,
    before: { name: before.name, permissions: parsePermissions(before.permissions) },
    after: { name: after!.name, permissions: parsePermissions(after!.permissions) },
    request: req,
  });

  return NextResponse.json({ ...after, permissions: parsePermissions(after!.permissions) });
});

export const DELETE = withAuth(PERMISSIONS.ROLES_MANAGE, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const before = await loadRole(id);
  if (!before) return NextResponse.json({ error: 'Role not found.' }, { status: 404 });

  const [assigned] = await db
    .select({ n: sql<number>`count(*)` })
    .from(adminUsers)
    .where(eq(adminUsers.roleId, id));

  const count = Number(assigned?.n ?? 0);
  if (count > 0) {
    // admin_users.roleId has no foreign key, so deleting the role would leave
    // those staff pointing at nothing and silently holding no permissions.
    return NextResponse.json(
      {
        error: `${count} staff member${count === 1 ? '' : 's'} still use this role. Reassign them first.`,
        code: 'ROLE_IN_USE',
        staffCount: count,
      },
      { status: 409 }
    );
  }

  await db.delete(adminRoles).where(eq(adminRoles.id, id));
  invalidateStaffCache();

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.DELETE,
    entityType: AUDIT_ENTITY.ADMIN_ROLE,
    entityId: id,
    before: { name: before.name, permissions: parsePermissions(before.permissions) },
    request: req,
  });

  return NextResponse.json({ message: 'Role deleted.' });
});
