import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminRoles, adminUsers } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS, parsePermissions, serializePermissions } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import { clinicNow } from '@/lib/datetime';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const roleSchema = z.object({
  name: z.string().trim().min(1, 'Give the role a name').max(255),
  permissions: z.array(z.string()).default([]),
});

export const GET = withAuth(PERMISSIONS.ROLES_MANAGE, async () => {
  const rows = await db
    .select({
      id: adminRoles.id,
      name: adminRoles.name,
      permissions: adminRoles.permissions,
      createdAt: adminRoles.createdAt,
      updatedAt: adminRoles.updatedAt,
      staffCount: sql<number>`(
        SELECT COUNT(*) FROM ${adminUsers} WHERE ${adminUsers.roleId} = ${adminRoles.id}
      )`,
    })
    .from(adminRoles)
    .orderBy(adminRoles.name);

  // parsePermissions never throws: the column is text, and one malformed row
  // must not take down the whole roles list.
  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      permissions: parsePermissions(r.permissions),
      staffCount: Number(r.staffCount),
    }))
  );
});

export const POST = withAuth(PERMISSIONS.ROLES_MANAGE, async (req, ctx) => {
  const parsed = roleSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const now = clinicNow();
  const row = {
    id: uuidv4(),
    name: parsed.data.name,
    // Unknown slugs are dropped here, so a stale client cannot store a
    // permission the application does not understand.
    permissions: serializePermissions(parsed.data.permissions),
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(adminRoles).values(row);

  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.CREATE,
    entityType: AUDIT_ENTITY.ADMIN_ROLE,
    entityId: row.id,
    after: { name: row.name, permissions: parsePermissions(row.permissions) },
    request: req,
  });

  return NextResponse.json({ ...row, permissions: parsePermissions(row.permissions) }, { status: 201 });
});
