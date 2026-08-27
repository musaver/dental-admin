import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, adminRoles } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const BCRYPT_COST = 12;

/**
 * Explicit allowlist. The previous implementation spread the raw request body
 * into `.set()`, which let any authenticated staff member PATCH their own
 * `roleId` to Admin/Owner. Never spread the body here.
 */
const updateSchema = z
  .object({
    email: z.string().email().max(255),
    password: z.string().min(10).max(200),
    name: z.string().max(255).nullable(),
    roleId: z.string().min(1).max(255),
    branchId: z.string().max(255).nullable(),
    phone: z.string().max(20).nullable(),
    staffType: z.enum([
      'owner',
      'dentist',
      'hygienist',
      'assistant',
      'receptionist',
      'manager',
      'other',
    ]),
    licenseNumber: z.string().max(50).nullable(),
    signatureUrl: z.string().max(500).nullable(),
    isActive: z.boolean(),
  })
  .partial();

function parsePermissions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadAdmin(id: string) {
  const [row] = await db
    .select({
      admin: adminUsers,
      role: {
        id: adminRoles.id,
        name: adminRoles.name,
        permissions: adminRoles.permissions,
      },
    })
    .from(adminUsers)
    .leftJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
    .where(eq(adminUsers.id, id))
    .limit(1);

  if (!row) return null;
  const { password: _password, ...safe } = row.admin;
  return {
    ...safe,
    role: row.role ? { ...row.role, permissions: parsePermissions(row.role.permissions) } : null,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = await loadAdmin(id);
    if (!admin) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    }
    return NextResponse.json(admin);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get admin' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const [existing] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    }

    if (input.roleId) {
      const [roleData] = await db
        .select({ id: adminRoles.id })
        .from(adminRoles)
        .where(eq(adminRoles.id, input.roleId))
        .limit(1);

      if (!roleData) {
        return NextResponse.json({ error: 'Invalid role ID' }, { status: 400 });
      }
    }

    // Build the update from the allowlist only. An omitted key is left alone;
    // an empty password means "keep the current one".
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      'email',
      'name',
      'roleId',
      'branchId',
      'phone',
      'staffType',
      'licenseNumber',
      'signatureUrl',
      'isActive',
    ] as const) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    if (input.password) {
      patch.password = await bcrypt.hash(input.password, BCRYPT_COST);
    }

    await db.update(adminUsers).set(patch).where(eq(adminUsers.id, id));

    return NextResponse.json(await loadAdmin(id));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update admin' }, { status: 500 });
  }
}

/**
 * Hard delete is not supported. ~15 tables reference `admin_users.id`
 * (createdBy, performedBy, recordedBy, dentistId, actorId, …) with no foreign
 * keys, so deleting a staff row silently orphans clinical records and audit
 * entries. Deactivate instead.
 */
export async function DELETE() {
  return NextResponse.json(
    {
      error:
        'Staff cannot be deleted because clinical and audit records reference them. Set isActive to false instead.',
    },
    { status: 405 }
  );
}
